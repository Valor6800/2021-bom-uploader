/**
 * Visual verification runner: screenshots, accessibility (axe), vocabulary
 * and console checks against a throwaway Vite dev server with every /api call
 * served from tests/visual/fixtures.
 *
 * Usage:
 *   npm run test:visual -- --inc INC-5      one increment's scenarios
 *   npm run test:visual -- --all            every scenario
 *   SHOTS_DIR=some/dir npm run test:visual -- --inc INC-5
 *
 * Safety:
 * - Vite runs on 127.0.0.1:5191 (never the user's 5173) with PORT=9 in its
 *   environment, so its /api proxy targets a dead port even if a mock is
 *   missed. Nothing can reach a real API server, or through it the tracker.
 * - Routing uses a pathname predicate, not a glob: Vite serves the API client
 *   module as /src/api/client.js, which a `** /api/ **` glob would swallow.
 * - A /api/ request with no fixture is aborted and fails the run.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const FIXTURES = path.join(__dirname, 'fixtures');
const HOST = '127.0.0.1';
const PORT = 5191;
const BASE = `http://${HOST}:${PORT}`;
const SHOTS_DIR = path.resolve(REPO, process.env.SHOTS_DIR || 'tests/visual/output');
const FIXED_TIME = new Date('2026-10-30T10:00:00-05:00');

const VIEWPORTS = {
  laptop: { width: 1366, height: 768 },
  tablet: { width: 1024, height: 768 },
  portrait: { width: 768, height: 1024 },
};

/** Words that must not appear on the BOM screens (design section 4.5). */
const FORBIDDEN_WORDS = /\b(epic|epic link|issue|issue type|custom field|story|jira)\b/i;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixtureCache = new Map();
function fixture(name) {
  if (!fixtureCache.has(name)) {
    const file = path.join(FIXTURES, `${name}.json`);
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Missing or unreadable fixture "${name}" (${file}): ${err.message}. Run npm run test:visual:fixtures.`);
    }
    fixtureCache.set(name, data);
  }
  return fixtureCache.get(name);
}

/**
 * An API route a scenario answers. `query` entries must all match; a value
 * that is a comma list matches in any order.
 * @typedef {{ method: string, path: string|RegExp, query?: Record<string,string>,
 *   fixture?: string, respond?: (req: { url: URL, body: any, calls: number }) => { status: number, body: any } }} ApiRoute
 */

function sameList(a, b) {
  const split = (v) => String(v).split(',').map((s) => s.trim()).sort().join(',');
  return split(a) === split(b);
}

function matchRoute(route, method, url) {
  if (route.method !== method) return false;
  const pathOk = route.path instanceof RegExp ? route.path.test(url.pathname) : route.path === url.pathname;
  if (!pathOk) return false;
  for (const [key, value] of Object.entries(route.query ?? {})) {
    const actual = url.searchParams.get(key);
    if (actual === null || !sameList(actual, value)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Scenario
 * @property {string} inc            Increment id, e.g. 'INC-5'.
 * @property {string} name           Screenshot base name.
 * @property {string} url            Path to open.
 * @property {keyof VIEWPORTS} [viewport]
 * @property {ApiRoute[]} [api]
 * @property {boolean} [bom]         Apply the vocabulary check.
 * @property {boolean} [assemble]    An Assembly-page screen: no "Cut Version" anywhere.
 * @property {number[]} [expectStatuses]  HTTP statuses the fixtures answer on
 *   purpose; Chromium's matching "Failed to load resource" line is allowed.
 * @property {string} [waitFor]      Selector that means the page is ready.
 * @property {(page: import('playwright').Page, ctx: object) => Promise<void>} [run]
 *   Interactions and assertions; may call ctx.shot(name) for extra shots.
 * @property {boolean} [skipMainShot]
 * @property {string} [init]        Script run before the page loads (addInitScript)
 * @property {string[]} [axeKnown]  axe rule ids reported but not failed. Only
 *   for legacy, non-BOM screens whose colours design section 4.2 keeps on
 *   purpose (e.g. #6b7280 "dim" text); never allowed with `bom: true`.
 */

/** Why a legacy screen may carry known colour findings. */
const LEGACY_COLOURS = ['color-contrast', 'link-in-text-block'];

const purchasingSignedIn = [{ method: 'GET', path: '/api/purchasing/queue', fixture: 'purchasing-queue' }];
const receivingSignedIn = [{ method: 'GET', path: '/api/receiving', fixture: 'receiving' }];

// ---------------------------------------------------------------------------
// INC-6: Designer page helpers and scenarios
// ---------------------------------------------------------------------------

const DESIGN_URL = '/a/HAR-2030/design';

/** Answer with `name`'s fixture. */
const fx = (name) => () => fixture(name);

/** Requests the page made, filtered by method and path (string or RegExp). */
function sent(ctx, method, pathMatch) {
  return ctx.state.requests.filter((r) => r.method === method
    && (pathMatch instanceof RegExp ? pathMatch.test(r.path) : r.path === pathMatch));
}

async function waitForSent(ctx, method, pathMatch, count = 1, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const list = sent(ctx, method, pathMatch);
    if (list.length >= count) return list;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new CheckError(`Check failed: expected ${count} ${method} ${pathMatch} request(s), saw ${sent(ctx, method, pathMatch).length}`);
}

async function expectText(page, text, timeout = 5000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout })
    .catch(() => { throw new CheckError(`Check failed: expected text "${text}"`); });
}

async function expectNoText(page, text) {
  const n = await page.getByText(text, { exact: false }).count();
  assertTrue(n === 0, `text "${text}" should be absent (found ${n})`);
}

const partRow = (page, text) => page.locator('tr.part-row', { hasText: text });
const chip = (page, label) => page.locator('.build-chip', { hasText: label });
const button = (page, name) => page.getByRole('button', { name, exact: true });

/** The Designer's reads for HAR-2030. Earlier entries win, so put overrides in `extra`. */
function designerApi({
  builds = 'builds-two',
  stories = 'stories-chain-HAR-2030',
  buildParts = { 'HAR-2051': 'build-parts-HAR-2051', 'HAR-2052': 'build-parts-HAR-2052' },
  extra = [],
} = {}) {
  return [
    ...extra,
    { method: 'GET', path: '/api/epics/HAR-2030', fixture: 'epic-HAR-2030' },
    { method: 'GET', path: '/api/revisions/chain/HAR-2030', fixture: 'chain-HAR-2030' },
    { method: 'GET', path: '/api/stories', query: { key: 'HAR-2030', chain: '1' }, fixture: stories },
    typeof builds === 'function'
      ? { method: 'GET', path: '/api/builds', query: { assemblyKey: 'HAR-2030' }, respond: builds }
      : { method: 'GET', path: '/api/builds', query: { assemblyKey: 'HAR-2030' }, fixture: builds },
    ...Object.entries(buildParts).map(([k, name]) => ({ method: 'GET', path: `/api/builds/${k}/parts`, fixture: name })),
  ];
}

const previewRoute = { method: 'POST', path: '/api/parts/preview', fixture: 'preview-HAR-2030' };
const cutRoute = (buildKey, name) => ({ method: 'POST', path: `/api/builds/${buildKey}/cut-version`, fixture: name });
const statusRoute = (respond) => ({ method: 'GET', path: '/api/builds/status', respond });

async function openCutDialog(page) {
  await button(page, 'Cut Version').first().click();
  await page.locator('dialog[open]').waitFor({ state: 'visible', timeout: 5000 });
}

async function confirmCut(page) {
  await page.locator('dialog[open]').getByRole('button', { name: /^(Cut Version|Try again)$/ }).click();
}

/** @type {Scenario[]} */
const INC6_SCENARIOS = [
  {
    inc: 'INC-6',
    name: 'designer-no-builds',
    url: DESIGN_URL,
    bom: true,
    api: designerApi({ builds: 'builds-none', stories: 'stories-chain-one', buildParts: {} }),
    waitFor: 'text=No Builds yet',
    async run(page) {
      await expectText(page, 'Create Build 1 to add these Parts to it.');
      const box = partRow(page, 'HAR-2031').locator('input[type=checkbox]');
      assertTrue(await box.isDisabled(), 'Part checkbox is disabled before a Build exists');
      await expectText(page, 'Name: Test Assembly Build 1');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-no-builds-cad-disabled',
    url: DESIGN_URL,
    bom: true,
    api: designerApi({ builds: 'builds-none', stories: 'stories-chain-one', buildParts: {} }),
    waitFor: 'text=No Builds yet',
    async run(page, ctx) {
      const cad = button(page, 'Update from CAD');
      await assertAttr(cad, 'aria-disabled', 'true');
      assertEqual((await page.locator('#cad-help').textContent()).trim(), 'Create Build 1 first.', 'CAD help text');
      await cad.focus();
      // Playwright treats aria-disabled as not clickable; force the click to
      // prove the page ignores it too.
      await cad.click({ force: true });
      await page.waitForTimeout(200);
      assertEqual(sent(ctx, 'POST', '/api/parts/preview').length, 0, 'preview requests from a disabled button');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-har2031-linked',
    url: DESIGN_URL,
    bom: true,
    api: designerApi({
      builds: 'builds-none',
      stories: 'stories-chain-one',
      buildParts: { 'HAR-2051': 'build-parts-empty' },
      extra: [
        { method: 'POST', path: '/api/builds', fixture: 'create-build-1' },
        { method: 'POST', path: '/api/builds/HAR-2051/save', fixture: 'save-link-HAR-2031' },
      ],
    }),
    waitFor: 'text=No Builds yet',
    async run(page, ctx) {
      await button(page, 'Create Build 1').click();
      const [create] = await waitForSent(ctx, 'POST', '/api/builds');
      assertEqual(create.body, { assemblyKey: 'HAR-2030', revisionChainKeys: ['HAR-2030'], name: 'Test Assembly' }, 'Create Build 1 body');
      await chip(page, 'Build 1').waitFor({ state: 'visible' });
      await assertAttr(chip(page, 'Build 1'), 'aria-pressed', 'true');
      await expectNoText(page, 'No Builds yet');

      await partRow(page, 'HAR-2031').getByRole('checkbox', { name: 'Add HAR-2031 to this Build' }).check();
      await expectText(page, 'Unsaved: 0 new Parts · 0 changes · 1 added to Build 1');
      await button(page, 'Save').click();
      const [save] = await waitForSent(ctx, 'POST', '/api/builds/HAR-2051/save');
      assertEqual(save.body, { creates: [], updates: [], links: [{ ref: 'HAR-2031', key: 'HAR-2031' }] }, 'links-only save body');
      // The re-fetch of HAR-2051's Parts still answers [] (search lag).
      await page.locator('tbody.parts-group-in tr.part-row', { hasText: 'HAR-2031' }).waitFor({ state: 'visible' });
      await expectNoText(page, 'Not in any Build');
      await expectText(page, 'Saved');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-with-builds',
    url: DESIGN_URL,
    bom: true,
    api: designerApi(),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await assertAttr(chip(page, 'Build 1'), 'aria-pressed', 'true');
      await expectText(page, 'Also in Build 2');
      await expectText(page, 'Test Assembly Build 1');
      await expectNoText(page, 'Need a different combination');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-new-build-form',
    url: DESIGN_URL,
    bom: true,
    skipMainShot: true,
    api: designerApi({
      buildParts: { 'HAR-2051': 'build-parts-HAR-2051', 'HAR-2052': 'build-parts-HAR-2052', 'HAR-2053': 'build-parts-empty' },
      extra: [{ method: 'POST', path: '/api/builds', fixture: 'create-build-3-desc' }],
    }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await button(page, '+ New Build').click();
      const focusedName = await page.evaluate(() => document.activeElement?.closest('.form-row')?.querySelector('label')?.textContent);
      assertEqual(focusedName, 'Name', 'focus moves to the Name field');
      await page.getByLabel("What's different? (optional)").fill('1in bash bar');
      assertEqual((await page.getByTestId('new-build-preview').textContent()).trim(), '→ "Test Assembly Build 3 - 1in bash bar"', 'preview line');
      await ctx.shot('designer-new-build-form');
      await button(page, 'Create Build 3').click();
      const [create] = await waitForSent(ctx, 'POST', '/api/builds');
      assertEqual(create.body.description, '1in bash bar', 'POST /api/builds description');
      await chip(page, 'Build 3').waitFor({ state: 'visible' });
      await assertAttr(chip(page, 'Build 3'), 'aria-pressed', 'true');
      await expectText(page, 'Test Assembly Build 3 - 1in bash bar');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-after-cad',
    url: DESIGN_URL,
    bom: true,
    skipMainShot: true,
    api: designerApi({
      extra: [
        previewRoute,
        {
          method: 'POST',
          path: '/api/builds/HAR-2051/save',
          respond: ({ calls }) => fixture(calls === 1 ? 'save-after-cad-partial' : 'save-link-HAR-2034'),
        },
      ],
    }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await button(page, 'Update from CAD').click();
      const [preview] = await waitForSent(ctx, 'POST', '/api/parts/preview');
      assertEqual(preview.body.fresh, true, 'Update from CAD sends fresh: true');
      await page.locator('tbody.parts-group-new').waitFor({ state: 'visible' });
      await expectText(page, 'Changed in CAD: Qty 1→3');
      await expectText(page, '1 BOM row was not');
      const steel = partRow(page, 'VF27P-0006A').getByLabel('Material for VF27P-0006A');
      await assertAttr(steel, 'aria-invalid', 'true');
      await expectText(page, '"Steel" isn\'t on the material list. Pick one.');
      await expectText(page, '1 row needs a fix before it can save.');
      await ctx.shot('designer-after-cad');

      await button(page, 'Save').click();
      const [save] = await waitForSent(ctx, 'POST', '/api/builds/HAR-2051/save');
      assertEqual(save.body.creates.map((c) => c.ref), ['VF27P-0004A'], 'creates hold the Spacer and not the held-back Steel row');
      assertEqual(save.body.updates.map((u) => u.ref), ['HAR-2031'], 'updates hold the CAD-changed Part');
      await expectText(page, "Created, but not added to Build 1: the team tracker didn't respond (503)");
      await ctx.shot('designer-save-partial-failure');

      await button(page, 'Retry VF27P-0004A').click();
      const saves = await waitForSent(ctx, 'POST', '/api/builds/HAR-2051/save', 2);
      assertEqual(saves[1].body, { creates: [], updates: [], links: [{ ref: 'HAR-2034', key: 'HAR-2034' }] }, 'Retry sends only a link');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-cut-version-confirm',
    url: DESIGN_URL,
    bom: true,
    skipMainShot: true,
    // The Builds re-fetch after the cut still says Draft (search lag).
    api: designerApi({ extra: [cutRoute('HAR-2051', 'cut-ok')] }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await openCutDialog(page);
      await expectText(page, 'This makes a version in OnShape named HAR-2051');
      await expectText(page, 'marks Build 2 Superseded');
      assertEqual(await page.evaluate(() => document.activeElement?.textContent), 'Cancel', 'focus starts on Cancel');
      await ctx.shot('designer-cut-version-confirm');
      await confirmCut(page);
      const [cut] = await waitForSent(ctx, 'POST', '/api/builds/HAR-2051/cut-version');
      assertEqual(cut.body, { assemblyKey: 'HAR-2030' }, 'cut body');
      await page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const cutButton = button(page, 'Cut Version');
      await assertAttr(cutButton, 'aria-disabled', 'true');
      await assertAttr(cutButton, 'title', 'Already cut');
      assertTrue((await chip(page, 'Build 1').textContent()).includes('Active'), 'Build 1 shows Active after the cut');
      assertTrue((await chip(page, 'Build 2').textContent()).includes('Superseded'), 'Build 2 shows Superseded after the cut');
      await ctx.shot('designer-after-cut');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-glossary-open',
    url: DESIGN_URL,
    bom: true,
    api: designerApi(),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await page.getByRole('button', { name: 'What is a Build?' }).click();
      await expectText(page, 'One specific combination of Parts for an Assembly');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-tablet-1024',
    url: DESIGN_URL,
    viewport: 'tablet',
    bom: true,
    api: designerApi({ extra: [previewRoute] }),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await button(page, 'Update from CAD').click();
      await page.locator('tbody.parts-group-new').waitFor({ state: 'visible' });
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-tablet-768',
    url: DESIGN_URL,
    viewport: 'portrait',
    bom: true,
    api: designerApi({ extra: [previewRoute] }),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await button(page, 'Update from CAD').click();
      await page.locator('tbody.parts-group-new').waitFor({ state: 'visible' });
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-load-404',
    url: '/a/HAR-9/design',
    bom: true,
    expectStatuses: [404],
    api: [
      { method: 'GET', path: '/api/epics/HAR-9', fixture: 'epic-HAR-9-404' },
      { method: 'GET', path: '/api/revisions/chain/HAR-9', fixture: 'chain-HAR-9-404' },
      { method: 'GET', path: '/api/stories', query: { key: 'HAR-9', chain: '1' }, fixture: 'stories-chain-HAR-9-404' },
    ],
    waitFor: "text=We couldn't find Assembly HAR-9.",
    async run(page) {
      await page.getByRole('link', { name: 'Back to all Assemblies' }).waitFor({ state: 'visible' });
      await expectNoText(page, 'Retry');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-builds-load-error',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [503],
    api: designerApi({ builds: 'builds-503' }),
    waitFor: "text=Couldn't load the Builds",
    async run(page) {
      await expectText(page, "Couldn't load the Builds: the team tracker didn't respond (503).");
      await assertAttr(button(page, 'Update from CAD'), 'aria-disabled', 'true');
      assertTrue(await button(page, '+ New Build').isDisabled(), '+ New Build is disabled after a failed load');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-cad-error',
    url: DESIGN_URL,
    bom: true,
    skipMainShot: true,
    expectStatuses: [502, 500],
    api: designerApi({
      extra: [{
        method: 'POST',
        path: '/api/parts/preview',
        respond: ({ calls }) => fixture(calls === 1 ? 'preview-onshape-502' : 'preview-missing-columns'),
      }],
    }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await button(page, 'Update from CAD').click();
      await expectText(page, "Couldn't read Parts from CAD: OnShape didn't respond (502).");
      await page.locator('tbody.parts-group-in tr.part-row').first().waitFor({ state: 'visible' });
      await ctx.shot('designer-cad-error');
      await button(page, 'Update from CAD').click();
      await expectText(page, "Couldn't read Parts from CAD: BOM table is missing required columns: name.");
      await ctx.shot('designer-cad-error-columns');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-new-build-error',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [503],
    api: designerApi({ extra: [{ method: 'POST', path: '/api/builds', fixture: 'create-build-503' }] }),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await button(page, '+ New Build').click();
      await button(page, 'Create Build 3').click();
      await expectText(page, "Couldn't create Build 3: the team tracker didn't respond (503).");
      assertTrue(await button(page, 'Create Build 3').isEnabled(), 'Create button is re-enabled');
      const described = await button(page, 'Create Build 3').getAttribute('aria-describedby');
      assertTrue(!!described && (await page.locator(`[id="${described}"]`).count()) === 1, 'error is linked to the Create button');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-new-build-clone-partial',
    url: DESIGN_URL,
    bom: true,
    api: designerApi({
      buildParts: { 'HAR-2051': 'build-parts-HAR-2051', 'HAR-2052': 'build-parts-HAR-2052', 'HAR-2053': 'build-parts-empty' },
      extra: [{ method: 'POST', path: '/api/builds', fixture: 'create-build-clone-partial' }],
    }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await button(page, '+ New Build').click();
      await page.getByRole('radio', { name: 'Copy Parts from' }).check();
      await button(page, 'Create Build 3').click();
      const [create] = await waitForSent(ctx, 'POST', '/api/builds');
      assertEqual(create.body.cloneFromBuildKey, 'HAR-2051', 'copy source');
      await expectText(page, "Build 3 was created, but 1 Part wasn't copied: HAR-2032. Add them from Other Parts in this Assembly.");
      await page.locator('tbody.parts-group-in tr.part-row', { hasText: 'HAR-2031' }).waitFor({ state: 'visible' });
      await page.locator('tbody.parts-group-other tr.part-row', { hasText: 'HAR-2032' }).waitFor({ state: 'visible' });
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-cut-version-error',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [502],
    api: designerApi({ extra: [cutRoute('HAR-2051', 'cut-onshape-502')] }),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await openCutDialog(page);
      await confirmCut(page);
      await expectText(page, "Couldn't cut the version: OnShape didn't respond (502).");
      await page.locator('dialog[open]').getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible' });
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-save-error',
    url: DESIGN_URL,
    bom: true,
    skipMainShot: true,
    expectStatuses: [503],
    api: designerApi({ extra: [{ method: 'POST', path: '/api/builds/HAR-2051/save', fixture: 'save-503' }] }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await page.getByLabel('Quantity for VF27P-0001A').fill('3');
      await expectText(page, 'Unsaved: 0 new Parts · 1 change · 0 added to Build 1');
      await button(page, 'Save').click();
      await expectText(page, "Couldn't save: the team tracker didn't respond (503). Nothing was changed.");
      assertEqual(await page.getByLabel('Quantity for VF27P-0001A').inputValue(), '3', 'the edit is kept');
      assertTrue(await button(page, 'Save').isEnabled(), 'Save is re-enabled');
      await ctx.shot('designer-save-error');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-cut-version-already-cut',
    url: DESIGN_URL,
    bom: true,
    skipMainShot: true,
    expectStatuses: [409],
    api: designerApi({ extra: [cutRoute('HAR-2051', 'cut-409-superseded')] }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await openCutDialog(page);
      await confirmCut(page);
      await expectText(page, 'Build 1 has already been cut.');
      await ctx.shot('designer-cut-version-already-cut');
      await page.locator('dialog[open] .dialog-footer').getByRole('button', { name: 'Close', exact: true }).click();
      const label = await chip(page, 'Build 1').textContent();
      assertTrue(label.includes('Superseded'), `Build 1 chip reads Superseded (got "${label}")`);
      await expectNoText(page, '409');
      await assertAttr(button(page, 'Cut Version'), 'title', 'Already cut');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-cut-version-stage-link',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [503],
    api: designerApi({ extra: [cutRoute('HAR-2051', 'cut-stage-link')] }),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await openCutDialog(page);
      await confirmCut(page);
      await expectText(page, "The OnShape version was made, but Build 1 couldn't be updated: the team tracker didn't respond (503). Try again.");
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-cut-version-stage-supersede',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [503],
    api: designerApi({
      extra: [
        cutRoute('HAR-2051', 'cut-stage-supersede'),
        statusRoute(fx('status-both-active-this-doc')),
      ],
    }),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await openCutDialog(page);
      await confirmCut(page);
      await expectText(page, 'Try again to finish');
      await expectText(page, "Build 1 is now Active, but Build 2 couldn't be marked Superseded");
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-two-active-builds',
    url: DESIGN_URL,
    bom: true,
    api: designerApi({ builds: 'builds-two-active', extra: [statusRoute(fx('status-both-active'))] }),
    waitFor: '.two-active',
    async run(page, ctx) {
      await expectText(page, 'Build 1 and Build 2 are both Active. Only one should be.');
      const repair = page.locator('.two-active').getByRole('button');
      assertEqual(await repair.allTextContents(), ['Make Build 1 the Active one'], 'repair buttons');
      assertEqual(sent(ctx, 'GET', '/api/builds/status').length >= 1, true, 'a by-key status check ran');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-two-active-confirm',
    url: DESIGN_URL,
    bom: true,
    skipMainShot: true,
    api: designerApi({
      builds: 'builds-two-active',
      extra: [statusRoute(fx('status-both-active')), cutRoute('HAR-2051', 'cut-repair-resumed')],
    }),
    waitFor: '.two-active',
    async run(page, ctx) {
      const make = button(page, 'Make Build 1 the Active one');
      await make.click();
      const dialog = page.locator('dialog[open]');
      await dialog.waitFor({ state: 'visible' });
      await expectText(page, "Build 2 will be marked Superseded. This can't be undone from ValorBOM.");
      assertEqual(await page.evaluate(() => document.activeElement?.textContent), 'Cancel', 'focus starts on Cancel');
      await ctx.shot('designer-two-active-confirm');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(200);
      assertEqual(sent(ctx, 'POST', /\/cut-version$/).length, 0, 'Cancel sends no cut request');
      await make.click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Mark Build 2 Superseded' }).click();
      const [cut] = await waitForSent(ctx, 'POST', '/api/builds/HAR-2051/cut-version');
      assertEqual(cut.body, { assemblyKey: 'HAR-2030' }, 'repair body');
      await page.locator('.two-active').waitFor({ state: 'detached', timeout: 5000 })
        .catch(() => { throw new CheckError('Check failed: the two-Active warning is gone after the repair'); });
      await ctx.shot('designer-two-active-resolved');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-two-active-stale',
    url: DESIGN_URL,
    bom: true,
    api: designerApi({ builds: 'builds-two-active', extra: [statusRoute(fx('status-2052-superseded'))] }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await waitForSent(ctx, 'GET', '/api/builds/status');
      await page.waitForTimeout(300);
      assertEqual(await page.locator('.two-active').count(), 0, 'no two-Active warning after the by-key check');
      // StrictMode runs the first effect twice; the second read is the same check.
      assertTrue(sent(ctx, 'GET', '/api/builds/status').length <= 2, 'the status check does not loop');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-two-active-stale-error',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [503],
    api: designerApi({ builds: 'builds-two-active', extra: [statusRoute(fx('status-503'))] }),
    waitFor: '.two-active',
    async run(page) {
      await expectText(page, "Couldn't check whether Build 1 and Build 2 are both Active.");
      await button(page, 'Check again').waitFor({ state: 'visible' });
      assertEqual(await page.getByRole('button', { name: /the Active one|Finish cutting/ }).count(), 0, 'no repair button');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-two-active-finish-cut',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [503],
    api: designerApi({
      builds: 'builds-active-and-draft',
      extra: [cutRoute('HAR-2052', 'cut-2052-stage-supersede'), statusRoute(fx('status-both-active-this-doc'))],
    }),
    waitFor: 'tbody.parts-group-in',
    async run(page) {
      await assertAttr(chip(page, 'Build 2'), 'aria-pressed', 'true');
      await openCutDialog(page);
      await confirmCut(page);
      await expectText(page, 'Try again to finish');
      await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
      await page.locator('.two-active[role=alert]').waitFor({ state: 'visible' });
      const repair = page.locator('.two-active').getByRole('button');
      assertEqual(await repair.allTextContents(), ['Finish cutting Build 2'], 'only the failed cut is offered');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-two-active-repair-409',
    url: DESIGN_URL,
    bom: true,
    expectStatuses: [409],
    api: designerApi({
      builds: 'builds-two-active',
      extra: [
        statusRoute(({ requests }) => fixture(requests.some((r) => r.path.endsWith('/cut-version'))
          ? 'status-2051-superseded' : 'status-both-active')),
        cutRoute('HAR-2051', 'cut-repair-409'),
      ],
    }),
    waitFor: '.two-active',
    async run(page) {
      await button(page, 'Make Build 1 the Active one').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Mark Build 2 Superseded' }).click();
      await expectText(page, 'Build 1 is no longer Active; nothing to fix.');
      await expectNoText(page, 'has already been cut');
      await page.locator('dialog[open] .dialog-footer').getByRole('button', { name: 'Close', exact: true }).waitFor({ state: 'visible' });
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-onboard-lagging-build',
    url: `${DESIGN_URL}?build=HAR-2051&cad=1`,
    bom: true,
    // Home doesn't exist until INC-8, so the route state Home would pass is
    // injected here (react-router keeps it under `usr`).
    init: `history.replaceState({ usr: { onboard: { assemblySummary: 'VF27A-0000A Test Assembly', build: ${JSON.stringify({
      key: 'HAR-2051', summary: 'Test Assembly Build 1', assemblyKey: 'HAR-2030', buildNumber: 1, status: 'Draft', onshapeVersionLink: null,
    })} } }, key: 'pw', idx: 0 }, '');`,
    api: designerApi({
      builds: 'builds-none',
      stories: 'stories-chain-one',
      buildParts: { 'HAR-2051': 'build-parts-empty' },
      extra: [previewRoute],
    }),
    waitFor: 'tbody.parts-group-new',
    async run(page, ctx) {
      await assertAttr(chip(page, 'Build 1'), 'aria-pressed', 'true');
      await expectNoText(page, 'No Builds yet');
      await page.waitForTimeout(500);
      assertEqual(sent(ctx, 'POST', '/api/parts/preview').length, 1, 'cad=1 sends exactly one preview');
      assertTrue(!page.url().includes('cad=1'), 'cad=1 is stripped from the URL');
      assertTrue(page.url().includes('build=HAR-2051'), '?build is kept');
    },
  },
  {
    inc: 'INC-6',
    name: 'designer-redirect',
    url: '/designer',
    skipMainShot: true,
    async run(page) {
      await page.waitForURL(`${BASE}/`);
    },
  },
];


// ---------------------------------------------------------------------------
// INC-7: Assembly page helpers and scenarios
// ---------------------------------------------------------------------------

const ASSEMBLE_URL = '/a/HAR-2030/assemble';

/** The Assembly page's reads for HAR-2030: three Builds, four Parts. */
function assemblyApi({
  builds = 'builds-three',
  stories = 'stories-chain-four',
  buildParts = {
    'HAR-2051': 'build-parts-a-HAR-2051',
    'HAR-2052': 'build-parts-a-HAR-2052',
    'HAR-2053': 'build-parts-a-HAR-2053',
  },
  extra = [],
} = {}) {
  return designerApi({ builds, stories, buildParts, extra });
}

const tab = (page, label) => page.getByRole('tab', { name: new RegExp(`^${label}\\b`) });
const inBuildRow = (page, text) => page.locator('tbody.parts-group-in tr.part-row', { hasText: text });
const otherRow = (page, text) => page.locator('tbody.parts-group-other tr.part-row', { hasText: text });

/** @type {Scenario[]} */
const INC7_SCENARIOS = [
  {
    inc: 'INC-7',
    name: 'assembly-page',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    api: assemblyApi(),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page) {
      await assertAttr(tab(page, 'Build 2'), 'aria-selected', 'true');
      await assertAttr(tab(page, 'Build 2'), 'tabindex', '0');
      await assertAttr(tab(page, 'Build 1'), 'tabindex', '-1');
      assertTrue(page.url().includes('build=HAR-2052'), 'the Active Build is the default tab');
      const panel = page.getByRole('tabpanel');
      assertEqual(await panel.getAttribute('aria-labelledby'), 'build-tab-HAR-2052', 'tabpanel names its tab');
      await inBuildRow(page, 'HAR-2031').waitFor();
      await inBuildRow(page, 'HAR-2033').waitFor();
      await expectText(page, 'Build 3 is newer');
      await expectText(page, 'Parts in other Builds, not in Build 2');
      assertEqual((await otherRow(page, 'HAR-2032').locator('.cell-where').textContent()).trim(), 'in Build 1', 'HAR-2032 location');
      assertEqual((await otherRow(page, 'HAR-2035').locator('.cell-where').textContent()).trim(), 'in Build 3', 'HAR-2035 location');
      await button(page, 'Move here: HAR-2035 to Build 2').waitFor();
      await button(page, 'Re-create here: HAR-2035 for Build 2').waitFor();
      await page.getByRole('link', { name: /OnShape version/ }).waitFor();
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-tabs-keyboard',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    skipMainShot: true,
    api: assemblyApi(),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page) {
      await tab(page, 'Build 2').focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForURL(/build=HAR-2053/);
      await assertAttr(tab(page, 'Build 3'), 'aria-selected', 'true');
      assertEqual(await page.evaluate(() => document.activeElement?.id), 'build-tab-HAR-2053', 'focus follows the arrow key');
      await expectText(page, 'Draft: not ready to build yet. The designer cuts a version when it is.');
      const open = page.getByRole('link', { name: 'Open Designer' });
      assertTrue((await open.getAttribute('href')).endsWith('/a/HAR-2030/design?build=HAR-2053'), 'Open Designer keeps the Build');
      await page.keyboard.press('ArrowRight');
      await page.waitForURL(/build=HAR-2051/);
      await page.keyboard.press('End');
      await page.waitForURL(/build=HAR-2053/);
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-no-builds',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    api: assemblyApi({ builds: 'builds-none', stories: 'stories-chain-one', buildParts: {} }),
    waitFor: 'text=No Builds yet',
    async run(page) {
      await expectText(page, 'Builds are made by the designer from CAD.');
      const open = page.getByRole('link', { name: 'Open Designer' });
      assertTrue((await open.getAttribute('href')).endsWith('/a/HAR-2030/design'), 'Open Designer link');
      assertEqual(await page.locator('table input').count(), 0, 'no editable Parts without a Build');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-clone-dialog',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    skipMainShot: true,
    api: assemblyApi({ extra: [{ method: 'POST', path: '/api/parts/HAR-2032/clone', fixture: 'clone-HAR-2032-ok' }] }),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page, ctx) {
      await button(page, 'Clone a part').click();
      const dialog = page.locator('dialog[open]');
      await dialog.waitFor({ state: 'visible' });
      await dialog.getByLabel('Copy from').selectOption('HAR-2032');
      await dialog.getByLabel('New Part name (optional)').fill('Plate spare');
      await dialog.getByLabel('Quantity (optional)').fill('1');
      await ctx.shot('assembly-clone-dialog');
      await dialog.getByRole('button', { name: 'Clone', exact: true }).click();
      const [req] = await waitForSent(ctx, 'POST', '/api/parts/HAR-2032/clone');
      assertEqual(req.body, { epicKey: 'HAR-2030', name: 'Plate spare', quantity: 1 }, 'clone body');
      await expectText(page, "Cloned as HAR-2040 (VF27P-0004A). It's listed under Parts in other Builds; Move it here to add it.");
      // The chain-Parts re-fetch is unchanged (search lag), yet the row shows.
      await otherRow(page, 'HAR-2040').waitFor({ state: 'visible' });
      assertEqual((await otherRow(page, 'HAR-2040').locator('.cell-where').textContent()).trim(), 'Not in any Build', 'clone location');
      assertEqual(sent(ctx, 'POST', '/api/parts/HAR-2032/clone').length, 1, 'one clone request');
      await ctx.shot('assembly-after-clone');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-menu-open',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    skipMainShot: true,
    api: assemblyApi({
      extra: [{ method: 'POST', path: '/api/builds/HAR-2052/archive', fixture: 'archive-ok' }],
    }),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page, ctx) {
      const toggle = button(page, 'More actions for Build 2');
      await toggle.click();
      await assertAttr(toggle, 'aria-expanded', 'true');
      const panelId = await toggle.getAttribute('aria-controls');
      const actions = page.locator(`[id="${panelId}"] button`);
      assertEqual(await actions.allTextContents(), ['Archive Build'], 'the disclosure holds only Archive Build');
      await ctx.shot('assembly-menu-open');
      await actions.first().click();
      const dialog = page.locator('dialog[open]');
      await dialog.waitFor({ state: 'visible' });
      await expectText(page, "It will be hidden from the Build list and marked as a dead end. This can't be undone from ValorBOM.");
      assertEqual(await page.evaluate(() => document.activeElement?.textContent), 'Cancel', 'focus starts on Cancel');
      await ctx.shot('assembly-archive-confirm');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(200);
      assertEqual(sent(ctx, 'POST', /\/archive$/).length, 0, 'Cancel sends no archive request');
      await toggle.click();
      await page.locator(`[id="${panelId}"] button`).first().click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Archive Build' }).click();
      await waitForSent(ctx, 'POST', '/api/builds/HAR-2052/archive');
      await expectText(page, 'Build 2 is archived.');
      assertTrue((await tab(page, 'Build 2').textContent()).includes('Archived'), 'the tab reads Archived');
      await button(page, 'Show archived (1)').waitFor();
      assertEqual(await page.getByRole('button', { name: 'More actions for Build 2' }).count(), 0, 'no Archive on an Archived Build');
      assertEqual(await page.locator('.parts-table input:enabled').count(), 0, 'an Archived Build is read-only');
      await ctx.shot('assembly-after-archive');
    },
  },
  {
    inc: 'INC-7',
    name: 'compare',
    url: `${ASSEMBLE_URL}?build=HAR-2052&view=compare`,
    bom: true,
    assemble: true,
    api: assemblyApi(),
    waitFor: '.compare-table',
    async run(page) {
      assertEqual(await page.getByLabel('First Build').inputValue(), 'HAR-2052', 'first Build');
      assertEqual(await page.getByLabel('Second Build').inputValue(), 'HAR-2053', 'second Build is the next one up');
      const rows = page.locator('.compare-table tbody tr');
      assertEqual(await rows.count(), 3, 'compare rows');
      assertTrue((await rows.nth(0).textContent()).includes('HAR-2031') && (await rows.nth(0).textContent()).includes('Same'), 'shared Part first');
      await expectText(page, 'Only in Build 2');
      await expectText(page, 'Only in Build 3');
      assertTrue((await rows.nth(1).locator('.visually-hidden').allTextContents()).includes('not in Build 3'), 'hidden text for —');
      await page.getByRole('link', { name: /Back to BOM/ }).waitFor();
    },
  },
  {
    inc: 'INC-7',
    name: 'print-preview',
    url: `${ASSEMBLE_URL}?build=HAR-2052&view=print`,
    bom: true,
    assemble: true,
    skipMainShot: true,
    api: assemblyApi(),
    waitFor: '.print-sheet',
    async run(page, ctx) {
      await expectText(page, 'VF27A-0000A Test Assembly — Build 2 (Active)');
      await expectText(page, 'Printed 2026-10-30');
      await expectText(page, 'OnShape version: https://cad.onshape.com/documents/');
      assertEqual(await page.locator('.print-table tbody tr').count(), 2, 'two Parts in Build 2');
      assertEqual(await page.locator('.print-table input').count(), 0, 'the tick column is not interactive');
      await ctx.shot('print-preview');
      await page.emulateMedia({ media: 'print' });
      assertTrue(!(await page.locator('nav[aria-label="Main"]').isVisible()), 'the nav is hidden in print');
      assertTrue(!(await button(page, 'Print').isVisible()), 'the Print button is hidden in print');
      assertTrue(!(await page.locator('.mode-switch').isVisible()), 'the header actions are hidden in print');
      assertTrue(await page.locator('.print-table td').nth(1).isVisible(), 'the Qty column prints');
      await ctx.shot('print-media');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-tablet-1024',
    url: ASSEMBLE_URL,
    viewport: 'tablet',
    bom: true,
    assemble: true,
    api: assemblyApi(),
    waitFor: 'tbody.parts-group-in tr.part-row',
  },
  {
    inc: 'INC-7',
    name: 'redirect-assembly-key',
    url: '/assembly/HAR-2030?build=HAR-2053',
    bom: true,
    assemble: true,
    api: assemblyApi(),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page) {
      await page.waitForURL(`${BASE}${ASSEMBLE_URL}?build=HAR-2053`);
      await assertAttr(tab(page, 'Build 3'), 'aria-selected', 'true');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-load-error',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    expectStatuses: [503],
    api: assemblyApi({ extra: [{ method: 'GET', path: '/api/epics/HAR-2030', fixture: 'epic-HAR-2030-503' }] }),
    waitFor: "text=Couldn't open this Assembly",
    async run(page) {
      await expectText(page, "Couldn't open this Assembly: the team tracker didn't respond (503).");
      await button(page, 'Retry').waitFor();
      await page.getByRole('link', { name: 'Back to all Assemblies' }).waitFor();
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-action-error',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    expectStatuses: [503],
    api: assemblyApi({ extra: [{ method: 'POST', path: '/api/builds/HAR-2052/save', fixture: 'move-503' }] }),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page) {
      await button(page, 'Move here: HAR-2035 to Build 2').click();
      await expectText(page, "Couldn't move HAR-2035 to Build 2: the team tracker didn't respond (503).");
      assertTrue(await button(page, 'Move here: HAR-2035 to Build 2').isEnabled(), 'Move is enabled again');
      assertTrue(await button(page, 'Re-create here: HAR-2035 for Build 2').isEnabled(), 'Re-create is enabled again');
      await otherRow(page, 'HAR-2035').waitFor();
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-recreate-409',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    expectStatuses: [409],
    api: assemblyApi({ extra: [{ method: 'POST', path: '/api/builds/HAR-2052/parts/HAR-2032/recreate', fixture: 'recreate-HAR-2032-409' }] }),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page) {
      await button(page, 'Re-create here: HAR-2032 for Build 2').click();
      await expectText(page, 'HAR-2032 was already re-created as HAR-2045. Re-create HAR-2045 instead.');
      const re = button(page, 'Re-create here: HAR-2032 for Build 2');
      await assertAttr(re, 'aria-disabled', 'true');
      await assertAttr(re, 'title', 'Already re-created as HAR-2045');
      await expectNoText(page, '409');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-after-move',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    // The Build's Parts re-fetch still lacks HAR-2035 (search lag).
    api: assemblyApi({ extra: [{ method: 'POST', path: '/api/builds/HAR-2052/save', fixture: 'move-HAR-2035-ok' }] }),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page, ctx) {
      await button(page, 'Move here: HAR-2035 to Build 2').click();
      const [save] = await waitForSent(ctx, 'POST', '/api/builds/HAR-2052/save');
      assertEqual(save.body, { links: [{ ref: 'HAR-2035', key: 'HAR-2035' }] }, 'Move sends the save body');
      await inBuildRow(page, 'HAR-2035').waitFor({ state: 'visible' });
      assertEqual(await otherRow(page, 'HAR-2035').count(), 0, 'HAR-2035 left the other-Builds section');
      await expectText(page, 'Moved HAR-2035 to Build 2.');
      assertEqual(sent(ctx, 'POST', /^\/api\/builds\/[^/]+\/parts$/).length, 0, 'nothing went to POST /api/builds/:k/parts');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-save',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    skipMainShot: true,
    api: assemblyApi({ extra: [{ method: 'POST', path: '/api/builds/HAR-2052/save', fixture: 'save-update-HAR-2033' }] }),
    waitFor: 'tbody.parts-group-in tr.part-row',
    async run(page, ctx) {
      await page.getByLabel('Quantity for VF27P-0003A').fill('2');
      await expectText(page, 'Unsaved: 1 change');
      await ctx.shot('assembly-save-bar');
      await button(page, 'Save').click();
      const [save] = await waitForSent(ctx, 'POST', '/api/builds/HAR-2052/save');
      assertEqual(save.body, {
        creates: [],
        updates: [{ ref: 'HAR-2033', key: 'HAR-2033', quantity: 2, material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'Black', thickness: '0.250', link: false }],
        links: [],
      }, 'Assembly-page save body');
      await inBuildRow(page, 'HAR-2033').getByText('Saved').waitFor();
      assertEqual(await page.getByLabel('Quantity for VF27P-0003A').inputValue(), '2', 'the saved value stays while search lags');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-after-recreate',
    url: `${ASSEMBLE_URL}?build=HAR-2053`,
    bom: true,
    assemble: true,
    skipMainShot: true,
    api: assemblyApi({
      stories: 'stories-chain-HAR-2030',
      buildParts: { 'HAR-2051': 'build-parts-a-HAR-2051', 'HAR-2052': 'build-parts-a-HAR-2052', 'HAR-2053': 'build-parts-b3-one' },
      extra: [{ method: 'POST', path: '/api/builds/HAR-2053/parts/HAR-2033/recreate', fixture: 'recreate-HAR-2033-ok' }],
    }),
    waitFor: 'tbody.parts-group-other tr.part-row',
    async run(page, ctx) {
      await button(page, 'Re-create here: HAR-2033 for Build 3').click();
      await waitForSent(ctx, 'POST', '/api/builds/HAR-2053/parts/HAR-2033/recreate');
      await inBuildRow(page, 'VF27P-0003B').waitFor({ state: 'visible' });
      const re = button(page, 'Re-create here: HAR-2033 for Build 3');
      await assertAttr(re, 'aria-disabled', 'true');
      assertTrue((await re.getAttribute('title')).includes('HAR-2041'), 'the tooltip names HAR-2041');
      await expectText(page, 'Re-created HAR-2033 as HAR-2041 (Revision B) in Build 3.');
      await ctx.shot('assembly-after-recreate');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-recreate-link-failed',
    url: `${ASSEMBLE_URL}?build=HAR-2053`,
    bom: true,
    assemble: true,
    expectStatuses: [503],
    api: assemblyApi({
      stories: 'stories-chain-HAR-2030',
      buildParts: { 'HAR-2051': 'build-parts-a-HAR-2051', 'HAR-2052': 'build-parts-a-HAR-2052', 'HAR-2053': 'build-parts-b3-one' },
      extra: [{ method: 'POST', path: '/api/builds/HAR-2053/parts/HAR-2033/recreate', fixture: 'recreate-HAR-2033-revises-503' }],
    }),
    waitFor: 'tbody.parts-group-other tr.part-row',
    async run(page) {
      await button(page, 'Re-create here: HAR-2033 for Build 3').click();
      await expectText(page, "Created HAR-2041, but couldn't record it as the next Revision of HAR-2033: the team tracker didn't respond (503).");
      await otherRow(page, 'VF27P-0003B').waitFor({ state: 'visible' });
      await button(page, 'Move here: HAR-2041 to Build 3').waitFor();
      await assertAttr(button(page, 'Re-create here: HAR-2033 for Build 3'), 'aria-disabled', 'true');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-recreate-already-revised',
    url: `${ASSEMBLE_URL}?build=HAR-2053`,
    bom: true,
    assemble: true,
    api: assemblyApi(),
    waitFor: 'tbody.parts-group-other tr.part-row',
    async run(page, ctx) {
      const re = button(page, 'Re-create here: HAR-2033 for Build 3');
      await assertAttr(re, 'aria-disabled', 'true');
      assertEqual(await re.getAttribute('title'), 'Already re-created as HAR-2035. Re-create HAR-2035 instead.', 'tooltip names VF27P-0003B');
      await re.click({ force: true });
      await page.waitForTimeout(200);
      assertEqual(sent(ctx, 'POST', /\/recreate$/).length, 0, 'a disabled Re-create sends nothing');
      assertTrue(await button(page, 'Re-create here: HAR-2032 for Build 3').isEnabled(), 'other Parts can still be re-created');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-two-active-builds',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    api: designerApi({ builds: 'builds-two-active', extra: [statusRoute(fx('status-both-active'))] }),
    waitFor: '.two-active',
    async run(page, ctx) {
      await expectText(page, 'Build 1 and Build 2 are both Active. Only one should be.');
      const repair = page.locator('.two-active').getByRole('button');
      assertEqual(await repair.allTextContents(), ['Make Build 1 the Active one'], 'repair buttons');
      assertEqual(await page.getByRole('button', { name: /Finish cutting/ }).count(), 0, 'no Finish cutting button');
      assertTrue(sent(ctx, 'GET', '/api/builds/status').length >= 1, 'a by-key status check ran');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-two-active-confirm',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    skipMainShot: true,
    api: designerApi({
      builds: 'builds-two-active',
      extra: [statusRoute(fx('status-both-active')), cutRoute('HAR-2051', 'cut-repair-resumed')],
    }),
    waitFor: '.two-active',
    async run(page, ctx) {
      const make = button(page, 'Make Build 1 the Active one');
      await make.click();
      const dialog = page.locator('dialog[open]');
      await dialog.waitFor({ state: 'visible' });
      await expectText(page, "Build 2 will be marked Superseded. This can't be undone from ValorBOM.");
      assertEqual(await page.evaluate(() => document.activeElement?.textContent), 'Cancel', 'focus starts on Cancel');
      await ctx.shot('assembly-two-active-confirm');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(200);
      assertEqual(sent(ctx, 'POST', /\/cut-version$/).length, 0, 'Cancel sends no cut request');
      await make.click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Mark Build 2 Superseded' }).click();
      const cuts = await waitForSent(ctx, 'POST', '/api/builds/HAR-2051/cut-version');
      assertEqual(cuts.length, 1, 'exactly one cut request');
      assertEqual(cuts[0].body, { assemblyKey: 'HAR-2030' }, 'repair body');
      await page.locator('.two-active').waitFor({ state: 'detached', timeout: 5000 })
        .catch(() => { throw new CheckError('Check failed: the two-Active warning is gone after the repair'); });
      await ctx.shot('assembly-two-active-resolved');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-two-active-stale',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    api: designerApi({ builds: 'builds-two-active', extra: [statusRoute(fx('status-2052-superseded'))] }),
    waitFor: 'tbody.parts-group-in',
    async run(page, ctx) {
      await waitForSent(ctx, 'GET', '/api/builds/status');
      await page.waitForTimeout(300);
      assertEqual(await page.locator('.two-active').count(), 0, 'no two-Active warning after the by-key check');
      assertTrue(sent(ctx, 'GET', '/api/builds/status').length <= 2, 'the status check does not loop');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-two-active-stale-error',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    expectStatuses: [503],
    api: designerApi({ builds: 'builds-two-active', extra: [statusRoute(fx('status-503'))] }),
    waitFor: '.two-active',
    async run(page) {
      await expectText(page, "Couldn't check whether Build 1 and Build 2 are both Active.");
      assertEqual(await page.locator('.two-active').getAttribute('role'), 'status', 'the check failure is a status line');
      await button(page, 'Check again').waitFor({ state: 'visible' });
      assertEqual(await page.getByRole('button', { name: /the Active one|Finish cutting/ }).count(), 0, 'no repair button');
    },
  },
  {
    inc: 'INC-7',
    name: 'assembly-two-active-repair-409',
    url: ASSEMBLE_URL,
    bom: true,
    assemble: true,
    expectStatuses: [409],
    api: designerApi({
      builds: 'builds-two-active',
      extra: [
        statusRoute(({ requests }) => fixture(requests.some((r) => r.path.endsWith('/cut-version'))
          ? 'status-2051-superseded' : 'status-both-active')),
        cutRoute('HAR-2051', 'cut-repair-409'),
      ],
    }),
    waitFor: '.two-active',
    async run(page) {
      await button(page, 'Make Build 1 the Active one').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Mark Build 2 Superseded' }).click();
      await expectText(page, 'Build 1 is no longer Active; nothing to fix.');
      await expectNoText(page, 'has already been cut');
      await page.locator('dialog[open] .dialog-footer').getByRole('button', { name: 'Close', exact: true }).waitFor({ state: 'visible' });
    },
  },
];

/** @type {Scenario[]} */
const SCENARIOS = [
  // ----- INC-5: tokens, primitives and the existing pages -----
  {
    inc: 'INC-5',
    name: 'nav-laptop',
    url: '/',
    // The old Dashboard keeps its dim text and gold inline links until INC-9.
    axeKnown: LEGACY_COLOURS,
    waitFor: 'nav[aria-label="Main"]',
    async run(page) {
      await expectVisible(page, 'a.skip-link', { attached: true });
      await expectVisible(page, 'main#main');
      for (const label of ['Dashboard', 'Assembly BOM', 'Parts Order', 'Parts Check-in']) {
        await expectVisible(page, `nav >> role=link[name=/${label}/]`);
      }
    },
  },
  {
    inc: 'INC-5',
    name: 'notfound',
    url: '/no-such-page',
    waitFor: 'text=Page Not Found',
  },
  {
    inc: 'INC-5',
    name: 'purchasing-signin',
    url: '/purchasing',
    api: [{ method: 'GET', path: '/api/purchasing/queue', fixture: 'auth-401' }],
    expectStatuses: [401],
    waitFor: 'text=Sign in with Authentik',
  },
  {
    inc: 'INC-5',
    name: 'receiving-signin',
    url: '/receiving',
    api: [{ method: 'GET', path: '/api/receiving', fixture: 'auth-401' }],
    expectStatuses: [401],
    waitFor: 'text=Sign in with Authentik',
  },
  {
    inc: 'INC-5',
    name: 'purchasing-vendor-group',
    url: '/purchasing',
    api: purchasingSignedIn,
    waitFor: '.card-toggle',
    skipMainShot: true,
    async run(page, ctx) {
      const group = page.locator('.card', { has: page.locator('.vendor-group-source') }).first();
      const toggle = group.locator('.card-toggle');
      const table = group.locator('table');
      const source = group.locator('.vendor-group-source select');

      await assertAttr(toggle, 'aria-expanded', 'true');
      await source.selectOption('LISD');
      await assertEqual(await source.inputValue(), 'LISD', 'Source select value');
      await assertTrue(await table.isVisible(), 'vendor group stays expanded after a Source change');
      await assertAttr(toggle, 'aria-expanded', 'true');
      await ctx.shot('purchasing-vendor-group');

      await toggle.click();
      await assertAttr(toggle, 'aria-expanded', 'false');
      await assertTrue(!(await table.isVisible()), 'vendor group collapses from its title toggle');
      const bodyId = await toggle.getAttribute('aria-controls');
      await assertTrue((await page.locator(`[id="${bodyId}"]`).count()) === 1, 'aria-controls resolves while collapsed');
      await ctx.shot('purchasing-vendor-group-collapsed');
    },
  },
  {
    inc: 'INC-5',
    name: 'receiving-group',
    url: '/receiving',
    // Receiving keeps its existing colours (design section 4.2).
    axeKnown: LEGACY_COLOURS,
    api: receivingSignedIn,
    waitFor: '.card-toggle',
    async run(page) {
      const toggle = page.locator('.card-toggle').first();
      await assertAttr(toggle, 'aria-expanded', 'true');
    },
  },
  {
    inc: 'INC-5',
    name: 'focus-ring',
    url: '/purchasing',
    api: purchasingSignedIn,
    waitFor: '.card-toggle',
    skipMainShot: true,
    async run(page, ctx) {
      // First Tab lands on the skip link; keep going to the first nav link.
      await tabUntil(page, (el) => el.classList.contains('nav-link'), 'a nav link');
      await ctx.shot('focus-ring', { fullPage: false });
      await tabUntil(page, (el) => el.classList.contains('card-toggle'), 'a Card toggle');
      await page.locator(':focus').scrollIntoViewIfNeeded();
      await ctx.shot('focus-ring-card', { fullPage: false });
    },
  },
  ...INC6_SCENARIOS,
  ...INC7_SCENARIOS,
];

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

class CheckError extends Error {}

function assertTrue(cond, message) {
  if (!cond) throw new CheckError(`Check failed: ${message}`);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new CheckError(`Check failed: ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function assertAttr(locator, name, expected) {
  const actual = await locator.getAttribute(name);
  assertEqual(actual, expected, `${name} attribute`);
}

async function expectVisible(page, selector, { attached = false } = {}) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: attached ? 'attached' : 'visible', timeout: 5000 })
    .catch(() => { throw new CheckError(`Check failed: expected ${selector} to be ${attached ? 'present' : 'visible'}`); });
}

async function tabUntil(page, predicateSource, description, maxTabs = 40) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(`(${predicateSource.toString()})(document.activeElement)`);
    if (hit) return;
  }
  throw new CheckError(`Check failed: Tab never reached ${description}`);
}

// ---------------------------------------------------------------------------
// Vite
// ---------------------------------------------------------------------------

function listeners() {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim();
  } catch {
    return ''; // lsof exits 1 when nothing matches
  }
}

async function startVite() {
  if (listeners()) throw new Error(`Port ${PORT} is already in use; stop that process first.`);
  const viteBin = path.join(REPO, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [
    viteBin, '--config', 'src/client/vite.config.js',
    '--host', HOST, '--port', String(PORT), '--strictPort',
  ], {
    cwd: REPO,
    // PORT=9 makes the dev proxy target a dead port (process env wins over .env).
    env: { ...process.env, PORT: '9', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return { child, output: () => output };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`Vite did not start within 30s:\n${output}`);
}

async function stopVite(child) {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const all = argv.includes('--all');
  const i = argv.indexOf('--inc');
  const inc = i >= 0 ? argv[i + 1] : null;
  if (!all && !inc) {
    console.error('Usage: npm run test:visual -- --inc INC-n | --all');
    process.exit(2);
  }
  return { all, inc };
}

async function installRoutes(context, scenario, state) {
  await context.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    state.routeCalls.push(`${method} ${url.pathname}${url.search}`);
    const match = (scenario.api ?? []).find((r) => matchRoute(r, method, url));
    if (!match) {
      state.unmatched.push(`${method} ${url.pathname}${url.search}`);
      await route.abort('failed');
      return;
    }
    let body = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    const key = `${method} ${url.pathname}`;
    state.requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    const calls = state.requests.filter((r) => `${r.method} ${r.path}` === key).length;
    const answer = match.respond
      ? match.respond({ url, body, calls, requests: state.requests })
      : fixture(match.fixture);
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      body: JSON.stringify(answer.body),
    });
  });
}

async function visibleText(page) {
  return page.evaluate(() => {
    const parts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || !node.textContent.trim()) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || el.closest('[hidden]')) continue;
      parts.push(node.textContent.trim());
    }
    // Accessible names count as visible copy for screen-reader users.
    for (const el of document.querySelectorAll('[aria-label],[title]')) {
      parts.push(el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '');
    }
    return parts.join('\n');
  });
}

async function runScenario(browser, scenario, report) {
  const viewport = VIEWPORTS[scenario.viewport ?? 'laptop'];
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const state = { routeCalls: [], unmatched: [], requests: [], consoleErrors: [] };
  const failures = [];
  await installRoutes(context, scenario, state);
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  if (scenario.init) await page.addInitScript(scenario.init);

  const allowed = (scenario.expectStatuses ?? []).map(
    (status) => `Failed to load resource: the server responded with a status of ${status}`,
  );
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (allowed.some((prefix) => text.startsWith(prefix))) return;
    state.consoleErrors.push(text);
  });
  page.on('pageerror', (err) => state.consoleErrors.push(`pageerror: ${err.message}`));

  const shots = [];
  const ctx = {
    state,
    async shot(name, { fullPage = true, scrollBottom = false } = {}) {
      if (scrollBottom) await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const file = path.join(SHOTS_DIR, `${name}.png`);
      // A full-page capture paints sticky bars at the viewport line, over
      // the content; let them sit at the end of the page for the capture.
      const unstick = fullPage
        ? await page.addStyleTag({ content: '.save-bar, .submit-bar { position: static !important; }' })
        : null;
      await page.screenshot({ path: file, fullPage });
      if (unstick) await unstick.evaluate((el) => el.remove());
      shots.push(name);
      await checkScreen(name);
    },
  };

  async function checkScreen(name) {
    const axe = await new AxeBuilder({ page }).analyze();
    const known = new Set(scenario.axeKnown ?? []);
    const serious = axe.violations.filter(
      (v) => (v.impact === 'serious' || v.impact === 'critical') && !known.has(v.id),
    );
    report.axe[name] = {
      url: page.url(),
      violations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        known: known.has(v.id),
        nodes: v.nodes.map((n) => n.target.join(' ')),
      })),
      passes: axe.passes.length,
    };
    for (const v of serious) {
      failures.push(`axe ${v.impact} "${v.id}" (${v.help}) on ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    }
    if (scenario.assemble) {
      // Q3: cutting a version is a CAD decision, so it is never offered here.
      const cut = await page.getByRole('button', { name: /Cut Version/ }).count()
        + await page.getByRole('link', { name: /Cut Version/ }).count();
      if (cut) failures.push(`an element named "Cut Version" on the Assembly page (${name})`);
    }
    if (scenario.bom) {
      const text = await visibleText(page);
      const hit = text.match(FORBIDDEN_WORDS);
      if (hit) failures.push(`forbidden word "${hit[0]}" on screen`);
    }
    const bad = (await visibleText(page)).includes('Request failed with status code');
    if (bad) failures.push('raw "Request failed with status code" text on screen');
  }

  try {
    await page.goto(`${BASE}${scenario.url}`, { waitUntil: 'networkidle' });
    if (scenario.waitFor) {
      await page.locator(scenario.waitFor).first().waitFor({ state: 'attached', timeout: 10000 });
    }
    if (scenario.run) await scenario.run(page, ctx);
    if (!scenario.skipMainShot) await ctx.shot(scenario.name);
  } catch (err) {
    failures.push(err instanceof CheckError ? err.message : `error: ${err.message}`);
  }

  for (const r of state.requests.filter((q) => q.method === 'POST' && q.path.endsWith('/cut-version'))) {
    if (JSON.stringify(Object.keys(r.body ?? {})) !== '["assemblyKey"]') {
      failures.push(`cut-version body carries more than assemblyKey: ${JSON.stringify(r.body)}`);
    }
  }
  if (state.unmatched.length) failures.push(`unmocked /api/ requests: ${state.unmatched.join(', ')}`);
  if (state.consoleErrors.length) failures.push(`console errors: ${state.consoleErrors.join(' | ')}`);
  await context.close();
  return { name: scenario.name, shots, failures };
}

/** The API client module must load untouched by the /api/ route handler. */
async function smokeCheck(browser) {
  const context = await browser.newContext();
  let intercepted = 0;
  await context.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    intercepted += 1;
    await route.abort('failed');
  });
  const page = await context.newPage();
  const res = await page.goto(`${BASE}/src/api/client.js`);
  const status = res?.status();
  await context.close();
  if (status !== 200 || intercepted !== 0) {
    throw new Error(`Smoke check failed: /src/api/client.js answered ${status}, route handler called ${intercepted} time(s)`);
  }
}

async function main() {
  const { all, inc } = parseArgs(process.argv.slice(2));
  const selected = SCENARIOS.filter((s) => all || s.inc === inc);
  if (selected.length === 0) {
    console.error(`No scenarios for ${inc}`);
    process.exit(2);
  }
  for (const s of selected) {
    if (s.bom && s.axeKnown?.length) throw new Error(`${s.name}: axeKnown is not allowed on a BOM screen`);
  }
  // Fail fast on a missing fixture, before starting anything.
  for (const s of selected) for (const r of s.api ?? []) if (r.fixture) fixture(r.fixture);

  await fs.mkdir(SHOTS_DIR, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), selection: all ? 'all' : inc, axe: {} };
  const results = [];
  let vite;
  let browser;
  let listenerLine = '';
  let exitCode = 0;
  try {
    vite = await startVite();
    listenerLine = listeners();
    if (!listenerLine.includes(`${HOST}:${PORT}`)) {
      throw new Error(`Vite is not bound to ${HOST}:${PORT}:\n${listenerLine}`);
    }
    browser = await chromium.launch();
    await smokeCheck(browser);
    for (const scenario of selected) {
      const result = await runScenario(browser, scenario, report);
      results.push(result);
      const mark = result.failures.length ? 'FAIL' : 'ok  ';
      console.log(`${mark} ${scenario.inc} ${scenario.name} -> ${result.shots.join(', ') || '(no shot)'}`);
      for (const f of result.failures) console.log(`       ${f}`);
    }
  } catch (err) {
    console.error(err.message);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (vite) await stopVite(vite.child);
  }

  let after = listeners();
  for (let i = 0; i < 10 && after; i++) {
    await new Promise((r) => setTimeout(r, 300));
    after = listeners();
  }
  report.listener = { during: listenerLine, after };
  report.results = results;
  await fs.writeFile(path.join(SHOTS_DIR, 'axe.json'), `${JSON.stringify(report, null, 2)}\n`);

  const failed = results.filter((r) => r.failures.length);
  if (after) {
    console.error(`Port ${PORT} still has a listener after shutdown:\n${after}`);
    exitCode = 1;
  }
  if (failed.length) exitCode = 1;
  console.log(`\n${results.length - failed.length}/${selected.length} scenarios passed; listener during run: ${listenerLine.split('\n').pop() || 'none'}; after: ${after || 'none'}`);
  console.log(`Screenshots and axe.json in ${path.relative(REPO, SHOTS_DIR) || '.'}`);
  process.exit(exitCode);
}

await main();
