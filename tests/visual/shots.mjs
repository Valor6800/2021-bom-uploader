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
 * @property {number[]} [expectStatuses]  HTTP statuses the fixtures answer on
 *   purpose; Chromium's matching "Failed to load resource" line is allowed.
 * @property {string} [waitFor]      Selector that means the page is ready.
 * @property {(page: import('playwright').Page, ctx: object) => Promise<void>} [run]
 *   Interactions and assertions; may call ctx.shot(name) for extra shots.
 * @property {boolean} [skipMainShot]
 * @property {string[]} [axeKnown]  axe rule ids reported but not failed. Only
 *   for legacy, non-BOM screens whose colours design section 4.2 keeps on
 *   purpose (e.g. #6b7280 "dim" text); never allowed with `bom: true`.
 */

/** Why a legacy screen may carry known colour findings. */
const LEGACY_COLOURS = ['color-contrast', 'link-in-text-block'];

const purchasingSignedIn = [{ method: 'GET', path: '/api/purchasing/queue', fixture: 'purchasing-queue' }];
const receivingSignedIn = [{ method: 'GET', path: '/api/receiving', fixture: 'receiving' }];

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
      for (const label of ['Dashboard', 'Assembly BOM', 'Designer', 'Parts Order', 'Parts Check-in']) {
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
    const answer = match.respond ? match.respond({ url, body, calls }) : fixture(match.fixture);
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
    async shot(name, { fullPage = true } = {}) {
      const file = path.join(SHOTS_DIR, `${name}.png`);
      await page.screenshot({ path: file, fullPage });
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
