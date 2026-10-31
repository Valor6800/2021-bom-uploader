#!/usr/bin/env node
/**
 * Live write check for ValorBOM's Jira/OnShape write paths.
 *
 * Usage: node .agents/tasks/live-write-check/live-check.mjs <step> [...]
 *   steps: snapshot | a | b | c | d | e | f | g | h | i | j
 *
 * Writes go ONLY through the app's HTTP API on 127.0.0.1:6803, exactly as the
 * UI sends them (src/client/src/api/client.js). Direct Jira/OnShape calls are
 * READ-ONLY GETs used for verification. Credentials are read from .env at
 * runtime and never printed.
 *
 * Every write first asserts that each target is in the allowed scope, and
 * aborts the whole run otherwise. Every write is appended to write-log.md.
 * Created keys and the write budget live in state.json next to this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const env = dotenv.parse(fs.readFileSync(path.join(REPO, '.env')));

const API = 'http://127.0.0.1:6803';
const JIRA = env.JIRA_BASE_URL.replace(/\/+$/, '');
const STATE_FILE = path.join(HERE, 'state.json');
const WRITE_LOG = path.join(HERE, 'write-log.md');

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
const ASSEMBLY = 'HAR-2030';
const BUILD1 = 'HAR-2032';
const PART = 'HAR-2031';
const DOC = '8c64dfdcb66184646a7a3f17';
const WS = '82f00d3cbea6901ac26040bd';
const EL = 'faea62821490977c33bc8d7c';
const BUDGET = { builds: 2, recreate: 1, clone: 1 };

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { createdBuilds: [], createdParts: [], used: { builds: 0, recreate: 0, clone: 0 }, onshapeVersions: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n'); }
const state = loadState();

const allowedBuilds = () => new Set([BUILD1, ...state.createdBuilds]);
const allowedParts = () => new Set([PART, ...state.createdParts]);

function abort(msg) {
  console.error(`ABORT (scope): ${msg}`);
  process.exit(3);
}

/**
 * targets: [{ kind: 'build'|'part'|'assembly'|'onshape', key }]
 */
function assertScope(targets) {
  for (const t of targets) {
    if (t.kind === 'build' && !allowedBuilds().has(t.key)) abort(`Build ${t.key} not in scope`);
    if (t.kind === 'part' && !allowedParts().has(t.key)) abort(`Part ${t.key} not in scope`);
    if (t.kind === 'assembly' && t.key !== ASSEMBLY) abort(`Assembly ${t.key} not in scope`);
    if (t.kind === 'onshape' && t.key !== DOC) abort(`OnShape doc ${t.key} not in scope`);
  }
}

function useBudget(kind) {
  if (state.used[kind] >= BUDGET[kind]) abort(`write budget for ${kind} exhausted (${state.used[kind]}/${BUDGET[kind]})`);
  state.used[kind] += 1;
  saveState(state);
}

function logWrite({ method, endpoint, target, result }) {
  if (!fs.existsSync(WRITE_LOG)) {
    fs.writeFileSync(WRITE_LOG, '# Live write check: write log (append-only)\n\n'
      + '| Time (UTC) | Method | Endpoint | Target | Result |\n|---|---|---|---|---|\n');
  }
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  fs.appendFileSync(WRITE_LOG,
    `| ${new Date().toISOString()} | ${method} | ${esc(endpoint)} | ${esc(target)} | ${esc(result)} |\n`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

/** A write through the app API, scope-checked and logged. */
async function apiWrite(method, p, body, targets, describe = (r) => JSON.stringify(r.body).slice(0, 400)) {
  assertScope(targets);
  const r = await api(method, p, body);
  logWrite({
    method, endpoint: p,
    target: targets.map((t) => `${t.kind}:${t.key}`).join(', '),
    result: `HTTP ${r.status} ${describe(r)}`,
  });
  return r;
}

/** READ-ONLY Jira GET. */
async function jiraGet(p) {
  const res = await fetch(`${JIRA}/rest/api/2${p}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${env.JIRA_KEY}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const FIELDS = 'summary,status,issuetype,issuelinks,customfield_10110,customfield_10500,customfield_10501,'
  + 'customfield_10502,customfield_10201,customfield_10202,customfield_10204,customfield_10206,customfield_10207';

async function issue(key) {
  const r = await jiraGet(`/issue/${key}?fields=${FIELDS}`);
  if (r.status !== 200) return { key, error: r.status, body: r.body };
  const f = r.body.fields;
  return {
    key,
    summary: f.summary,
    type: f.issuetype?.name,
    status: f.status?.name,
    epicLink: f.customfield_10110 ?? null,
    revision: f.customfield_10500 ?? null,
    buildNumber: f.customfield_10501 ?? null,
    onshapeVersionLink: f.customfield_10502 ?? null,
    machinery: f.customfield_10201?.map((m) => m.value) ?? null,
    material: f.customfield_10202?.value ?? null,
    powdercoat: f.customfield_10204?.value ?? null,
    quantity: f.customfield_10206 ?? null,
    thickness: f.customfield_10207?.value ?? null,
    links: (f.issuelinks ?? []).map((l) => ({
      id: l.id,
      type: l.type?.name,
      // What the tracker shows on THIS issue's page for the link.
      reads: l.inwardIssue ? `${key} ${l.type?.inward} ${l.inwardIssue.key}` : `${key} ${l.type?.outward} ${l.outwardIssue?.key}`,
      side: l.inwardIssue ? 'inwardIssue' : 'outwardIssue',
      other: (l.inwardIssue ?? l.outwardIssue)?.key,
    })),
  };
}

async function jql(q, fields = 'summary,status,issuetype,customfield_10110,customfield_10501') {
  const r = await jiraGet(`/search?jql=${encodeURIComponent(q)}&fields=${fields}&maxResults=100`);
  return r;
}

/** READ-ONLY OnShape versions list, via the app's own client class. */
async function onshapeVersions() {
  const { OnshapeClient } = await import(path.join(REPO, 'src/server/clients/onshapeClient.js'));
  const c = new OnshapeClient({
    baseUrl: env.ONSHAPE_BASE_URL, accessKey: env.API_KEY, secretKey: env.SECRET_KEY, teamId: env.ONSHAPE_TEAM_ID,
  });
  const v = await c.listVersions(DOC);
  return v.map((x) => ({ id: x.id, name: x.name, description: x.description, createdAt: x.createdAt }));
}

const out = (label, v) => console.log(`\n== ${label}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Builds under the Assembly, by search (read-only). */
async function buildsUnderAssembly() {
  const r = await jql(`project = HAR AND issuetype = Build AND "Epic Link" = ${ASSEMBLY}`);
  return r.status === 200 ? r.body.issues.map((i) => ({
    key: i.key, summary: i.fields.summary, status: i.fields.status?.name, buildNumber: i.fields.customfield_10501,
  })) : { error: r.status, body: r.body };
}

/** Before a Cut Version: every sibling Build a supersede could touch must be in scope. */
async function assertSiblingsInScope() {
  const builds = await buildsUnderAssembly();
  if (!Array.isArray(builds)) abort(`could not list Builds under ${ASSEMBLY}`);
  for (const b of builds) {
    if (!allowedBuilds().has(b.key)) abort(`Build ${b.key} under ${ASSEMBLY} is not in scope; a supersede could touch it`);
  }
  return builds;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
const steps = {
  async snapshot() {
    out('state.json', state);
    for (const k of [ASSEMBLY, PART, BUILD1, ...state.createdBuilds, ...state.createdParts]) out(k, await issue(k));
    out(`Builds under ${ASSEMBLY}`, await buildsUnderAssembly());
    const parts = await jql(`project = HAR AND issuetype = Part AND "Epic Link" = ${ASSEMBLY}`);
    out(`Parts under ${ASSEMBLY}`, parts.status === 200 ? parts.body.issues.map((i) => `${i.key} ${i.fields.summary}`) : parts);
    out('OnShape versions (test doc)', await onshapeVersions());
  },

  async linktypes() {
    const r = await jiraGet('/issueLinkType');
    out('issueLinkType', r.body.issueLinkTypes?.filter((t) => ['Used In', 'Revises'].includes(t.name)));
    out(`transitions ${BUILD1}`, (await jiraGet(`/issue/${BUILD1}/transitions`)).body);
    out(`editmeta ${PART} field ids`, Object.keys((await jiraGet(`/issue/${PART}/editmeta`)).body.fields ?? {}));
    out(`editmeta ${BUILD1} field ids`, Object.keys((await jiraGet(`/issue/${BUILD1}/editmeta`)).body.fields ?? {}));
  },

  // a. Link HAR-2031 into Build 1 via the save endpoint; then repeat.
  async a() {
    for (const attempt of [1, 2]) {
      const r = await apiWrite('POST', `/api/builds/${BUILD1}/save`,
        { links: [{ ref: PART, key: PART }] },
        [{ kind: 'build', key: BUILD1 }, { kind: 'part', key: PART }]);
      out(`save links attempt ${attempt}`, r);
      await sleep(1500);
      const p = await issue(PART);
      out(`${PART} Used In links after attempt ${attempt}`, p.links.filter((l) => l.type === 'Used In'));
    }
    out(`${BUILD1} links`, (await issue(BUILD1)).links);
    await sleep(3000);
    out(`GET /api/builds/${BUILD1}/parts`, await api('GET', `/api/builds/${BUILD1}/parts`));
  },

  // b. Update quantity 1 -> 2 -> 1 via save (updates, link:false, as the Assembly page does).
  async b() {
    const before = await issue(PART);
    out(`${PART} before`, before);
    const item = (quantity) => ({
      ref: PART, key: PART, quantity,
      material: before.material ?? 'None',
      machinery: before.machinery?.[0] ?? 'None',
      powdercoat: before.powdercoat ?? 'None',
      thickness: before.thickness ?? 'None',
      link: false,
    });
    const original = before.quantity ?? 1;
    for (const q of [original + 1, original]) {
      const r = await apiWrite('POST', `/api/builds/${BUILD1}/save`, { updates: [item(q)] },
        [{ kind: 'build', key: BUILD1 }, { kind: 'part', key: PART }]);
      out(`save update quantity=${q}`, r);
      const after = await issue(PART);
      out(`${PART} after quantity=${q}`, {
        quantity: after.quantity, material: after.material, machinery: after.machinery,
        powdercoat: after.powdercoat, thickness: after.thickness, summary: after.summary,
      });
    }
  },

  // c. Cut Version on Build 1, then retry.
  async c() {
    await assertSiblingsInScope();
    assertScope([{ kind: 'onshape', key: DOC }, { kind: 'assembly', key: ASSEMBLY }]);
    const before = await onshapeVersions();
    for (const attempt of [1, 2]) {
      const r = await apiWrite('POST', `/api/builds/${BUILD1}/cut-version`, { assemblyKey: ASSEMBLY },
        [{ kind: 'build', key: BUILD1 }, { kind: 'onshape', key: DOC }]);
      out(`cut-version attempt ${attempt}`, r);
      if (r.status === 200 && attempt === 1) {
        const vid = /\/v\/([a-f0-9]{24})\//.exec(r.body.onshapeVersionLink ?? '')?.[1];
        state.onshapeVersions.push({ build: BUILD1, versionId: vid ?? null, link: r.body.onshapeVersionLink });
        saveState(state);
        logWrite({ method: '(effect)', endpoint: 'OnShape POST /api/documents/d/:did/versions', target: `onshape:${DOC}`, result: `version ${vid} created for ${BUILD1}` });
      }
    }
    const after = await onshapeVersions();
    out('OnShape versions before/after', { before: before.length, after: after.length, newest: after.slice(-2) });
    out(BUILD1, await issue(BUILD1));
  },

  // d. Create Build 2 (clone from Build 1) under HAR-2030.
  async d() {
    // The clone links every Part of Build 1 into Build 2: all must be in scope.
    const b1 = await issue(BUILD1);
    for (const l of b1.links.filter((x) => x.type === 'Used In')) {
      if (!allowedParts().has(l.other)) abort(`Part ${l.other} in ${BUILD1} is not in scope`);
    }
    await assertSiblingsInScope();
    useBudget('builds');
    const assembly = await issue(ASSEMBLY);
    const name = (assembly.summary ?? '').replace(/^\S+\s+/, '');
    const chain = (await api('GET', `/api/revisions/chain/${ASSEMBLY}`)).body;
    out('revision chain', chain);
    const keys = Array.isArray(chain) ? chain : (chain?.chain ?? [ASSEMBLY]);
    const body = { assemblyKey: ASSEMBLY, revisionChainKeys: keys.map((k) => (typeof k === 'string' ? k : k.key)), name, cloneFromBuildKey: BUILD1 };
    const r = await apiWrite('POST', '/api/builds', body, [{ kind: 'assembly', key: ASSEMBLY }, { kind: 'part', key: PART }]);
    out('create build', r);
    if (r.body?.build?.key) {
      state.createdBuilds.push(r.body.build.key);
      saveState(state);
      logWrite({ method: '(effect)', endpoint: 'createIssue Build', target: `build:${r.body.build.key}`, result: `created ${r.body.build.summary}; clone linked ${JSON.stringify(r.body.linked)}` });
      await sleep(1500);
      out(r.body.build.key, await issue(r.body.build.key));
    }
  },

  // e. Re-create HAR-2031 for Build 2.
  async e() {
    const build2 = state.createdBuilds[0];
    if (!build2) abort('no Build 2 in state');
    useBudget('recreate');
    const r = await apiWrite('POST', `/api/builds/${build2}/parts/${PART}/recreate`, undefined,
      [{ kind: 'build', key: build2 }, { kind: 'part', key: PART }]);
    out('recreate', r);
    const newKey = r.body?.key ?? r.body?.part?.key;
    if (newKey) {
      state.createdParts.push(newKey);
      saveState(state);
      logWrite({ method: '(effect)', endpoint: 'createIssue Part (Re-create)', target: `part:${newKey}`, result: `created revision ${r.body?.revision}` });
      await sleep(1500);
      out(newKey, await issue(newKey));
      out(PART, await issue(PART));
      out(build2, await issue(build2));
    }
  },

  // f. Cut Version on Build 2.
  async f() {
    const build2 = state.createdBuilds[0];
    if (!build2) abort('no Build 2 in state');
    await assertSiblingsInScope();
    const r = await apiWrite('POST', `/api/builds/${build2}/cut-version`, { assemblyKey: ASSEMBLY },
      [{ kind: 'build', key: build2 }, { kind: 'onshape', key: DOC }]);
    out('cut-version build 2', r);
    if (r.status === 200) {
      const vid = /\/v\/([a-f0-9]{24})\//.exec(r.body.onshapeVersionLink ?? '')?.[1];
      state.onshapeVersions.push({ build: build2, versionId: vid ?? null, link: r.body.onshapeVersionLink });
      saveState(state);
      logWrite({ method: '(effect)', endpoint: 'OnShape POST /api/documents/d/:did/versions', target: `onshape:${DOC}`, result: `version ${vid} created for ${build2}; superseded ${JSON.stringify(r.body.superseded)}` });
    }
    out(build2, await issue(build2));
    out(BUILD1, await issue(BUILD1));
    out('OnShape versions (newest 3)', (await onshapeVersions()).slice(-3));
  },

  // g. Clone a part from HAR-2031.
  async g() {
    useBudget('clone');
    const r = await apiWrite('POST', `/api/parts/${PART}/clone`, { epicKey: ASSEMBLY, name: 'Test Part Clone', quantity: 1 },
      [{ kind: 'part', key: PART }, { kind: 'assembly', key: ASSEMBLY }]);
    out('clone', r);
    if (r.body?.key) {
      state.createdParts.push(r.body.key);
      saveState(state);
      logWrite({ method: '(effect)', endpoint: 'createIssue Part (Clone)', target: `part:${r.body.key}`, result: `created ${r.body.fullPartNumber}` });
      await sleep(1500);
      out(r.body.key, await issue(r.body.key));
    }
    const season = await jql('project = HAR AND issuetype = Part AND summary ~ "VF27P-*"', 'summary');
    out('VF27P Parts in project', season.status === 200 ? season.body.issues.map((i) => `${i.key} ${i.fields.summary}`) : season);
  },

  // h. Archive Build 1.
  async h() {
    const r = await apiWrite('POST', `/api/builds/${BUILD1}/archive`, undefined, [{ kind: 'build', key: BUILD1 }]);
    out('archive', r);
    out(BUILD1, await issue(BUILD1));
    out(`transitions ${BUILD1}`, (await jiraGet(`/issue/${BUILD1}/transitions`)).body?.transitions?.map((t) => `${t.id} ${t.name} -> ${t.to?.name}`));
    out('status endpoint', await api('GET', `/api/builds/status?keys=${[BUILD1, ...state.createdBuilds].join(',')}`));
  },

  // i. Read paths after writes.
  async i() {
    const chainKeys = [ASSEMBLY];
    out('GET /api/builds', await api('GET', `/api/builds?assemblyKey=${ASSEMBLY}&revisionChainKeys=${chainKeys.join(',')}`));
    out('GET /api/stories chain', await api('GET', `/api/stories?key=${ASSEMBLY}&chain=1`));
    for (const b of [BUILD1, ...state.createdBuilds]) out(`GET /api/builds/${b}/parts`, await api('GET', `/api/builds/${b}/parts`));
    for (const p of [PART, ...state.createdParts]) out(`GET /api/builds/for-part/${p}`, await api('GET', `/api/builds/for-part/${p}`));
    const keys = [PART, ...state.createdParts].join(',');
    out('GET /api/parts/by-keys', await api('GET', `/api/parts/by-keys?keys=${keys}`));
    out('GET /api/revisions/chain part', await api('GET', `/api/revisions/chain/${state.createdParts[0] ?? PART}`));
    out('GET /api/builds/status', await api('GET', `/api/builds/status?keys=${[BUILD1, ...state.createdBuilds].join(',')}`));
  },

  // j. Onboarding preview for the existing Assembly URL (read-only endpoint).
  async j() {
    const url = `${env.ONSHAPE_BASE_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/documents/${DOC}/w/${WS}/e/${EL}`;
    const r = await api('POST', '/api/epics/onboard/preview', { url });
    out('onboard preview', { status: r.status, status2: r.body?.status, matchedOn: r.body?.matchedOn, assemblyKey: r.body?.assembly?.key, error: r.body?.error });
    out(`Assemblies with element ${EL}`, (await jql(`project = HAR AND issuetype = Assembly AND cf[10302] ~ "${EL}"`, 'summary,created')).body?.issues?.map((i) => `${i.key} ${i.fields.summary} ${i.fields.created}`));
  },
};

const [, , ...which] = process.argv;
if (which.length === 0) {
  console.error(`steps: ${Object.keys(steps).join(' ')}`);
  process.exit(2);
}
for (const s of which) {
  if (!steps[s]) { console.error(`unknown step ${s}`); process.exit(2); }
  console.log(`\n########## step ${s} ##########`);
  await steps[s]();
}
