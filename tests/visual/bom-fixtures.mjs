/**
 * Fixtures for the Designer (and later Assembly) screens, produced by the
 * real server services wired to fake Jira and OnShape clients, and error
 * bodies produced by the real errorHandler. Imported by make-fixtures.mjs
 * after it has set PROJECT_KEY, so every service sees project HAR.
 *
 * Raw input: tests/visual/raw/bom-har2030.json (the live BOM for HAR-2030,
 * trimmed to the fields the parser reads), with rows added below.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { EpicService } = await import('../../src/server/services/epicService.js');
const { BuildService } = await import('../../src/server/services/buildService.js');
const { PartService } = await import('../../src/server/services/partService.js');
const { BOMService } = await import('../../src/server/services/bomService.js');
const { RevisionService } = await import('../../src/server/services/revisionService.js');
const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
const { OnshapeApiError } = await import('../../src/server/clients/onshapeClient.js');
const { errorHandler } = await import('../../src/server/middleware/errorHandler.js');

export const DOC = '8c64dfdcb66184646a7a3f17';
export const WS = '82f00d3cbea6901ac26040bd';
export const EL = 'faea62821490977c33bc8d7c';
const ONSHAPE = 'https://cad.onshape.com';
export const LINK_THIS_DOC = `${ONSHAPE}/documents/${DOC}/v/5d1c0e2f9a7b3c4d5e6f7a8b/e/${EL}`;
export const LINK_OTHER_DOC = `${ONSHAPE}/documents/0a1b2c3d4e5f60718293a4b5/v/6e7f8a9b0c1d2e3f4a5b6c7d/e/1234567890abcdef12345678`;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * A Jira client fake. `search` entries answer the first JQL they match;
 * `fail` hooks return an error to throw for a call. Created keys come from
 * `nextKeys`.
 */
class FakeJira {
  constructor({ issues = {}, search = [], fail = {}, nextKeys = [] } = {}) {
    this.issues = clone(issues);
    this.search = search;
    this.fail = fail;
    this.nextKeys = [...nextKeys];
  }

  async searchIssues(jql) {
    const err = this.fail.search?.(jql);
    if (err) throw err;
    const hit = this.search.find(({ match }) => match(jql));
    if (!hit) return [];
    return clone(typeof hit.issues === 'function' ? hit.issues(jql) : hit.issues);
  }

  async getIssue(key, opts) {
    const err = this.fail.getIssue?.(key, opts);
    if (err) throw err;
    if (this.issues[key]) return clone(this.issues[key]);
    throw new JiraApiError('Issue Does Not Exist', 404, `/rest/api/2/issue/${key}`);
  }

  async createIssue(fields) {
    const err = this.fail.createIssue?.(fields);
    if (err) throw err;
    const key = this.nextKeys.shift();
    if (!key) throw new Error('FakeJira: no key left for createIssue');
    // A new Build starts as a Draft, as in the tracker's Build workflow.
    const status = fields.issuetype?.name === 'Build' ? { status: { name: 'Draft' } } : {};
    this.issues[key] = { key, fields: { ...fields, ...status, issuelinks: [] } };
    return { key };
  }

  async createIssueLink(type, inward, outward) {
    const err = this.fail.createIssueLink?.(type, inward, outward);
    if (err) throw err;
  }

  async updateIssue(key, fields) {
    const err = this.fail.updateIssue?.(key, fields);
    if (err) throw err;
  }

  async transitionIssue(key, id) {
    const err = this.fail.transitionIssue?.(key, id);
    if (err) throw err;
  }
}

function fakeOnshape({ bom, metadata, fail = {} } = {}) {
  return {
    baseUrl: ONSHAPE,
    async getElementMetadata() {
      const err = fail.metadata?.();
      if (err) throw err;
      return clone(metadata);
    },
    async getAssemblyBOM() {
      const err = fail.bom?.();
      if (err) throw err;
      return clone(bom);
    },
    async createVersion() {
      const err = fail.createVersion?.();
      if (err) throw err;
      return { id: '5d1c0e2f9a7b3c4d5e6f7a8b' };
    },
  };
}

const tracker503 = (endpoint = '/rest/api/2/search') => new JiraApiError('Service Unavailable', 503, endpoint);

/** Run an error through the real errorHandler and capture the response. */
function errorBody(err) {
  let status;
  let body;
  const res = {
    headersSent: false,
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    errorHandler(err, { method: 'GET', originalUrl: '/api/fixture' }, res, () => {});
  } finally {
    console.error = quiet;
  }
  return { status, body };
}

async function capture(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return { status: 200, body: await fn() };
  } catch (err) {
    return errorBody(err);
  } finally {
    console.warn = warn;
  }
}

// ---------------------------------------------------------------------------
// Raw Jira data
// ---------------------------------------------------------------------------

const assemblyIssue = {
  key: 'HAR-2030',
  fields: {
    summary: 'VF27A-0000A Test Assembly',
    issuetype: { name: 'Epic' },
    status: { name: 'New' },
    created: '2026-10-29T20:15:40.000+0000',
    customfield_10104: 'VF27A-0000A Test Assembly',
    customfield_10500: 'A',
    customfield_10300: DOC,
    customfield_10301: WS,
    customfield_10302: EL,
    issuelinks: [],
  },
};

function partIssue(key, summary, { qty = 1, material = 'PLA', machinery = '3D Printer', powdercoat, thickness, epic = 'HAR-2030', links = [] } = {}) {
  return {
    key,
    fields: {
      summary,
      issuetype: { name: 'Part' },
      project: { key: 'HAR' },
      customfield_10110: epic,
      customfield_10206: qty,
      customfield_10202: { value: material },
      customfield_10201: [{ value: machinery }],
      ...(powdercoat ? { customfield_10204: { value: powdercoat } } : {}),
      ...(thickness ? { customfield_10207: { value: thickness } } : {}),
      customfield_10500: summary.match(/^V[RF]\d{2}P-\d{4}([A-Z])/)?.[1] ?? null,
      issuelinks: links,
    },
  };
}

const P2031 = partIssue('HAR-2031', 'VF27P-0001A Test Part');
const P2032 = partIssue('HAR-2032', 'VF27P-0002A Plate', { qty: 2, material: 'AL 6061', machinery: 'CNC Router' });
const P2033 = partIssue('HAR-2033', 'VF27P-0003A Bash bar 2"', { material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'Black', thickness: '0.250' });
// The 1" bash bar: the next Revision of HAR-2033, used in Build 3.
const P2035 = partIssue('HAR-2035', 'VF27P-0003B Bash bar 1"', { material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'Black', thickness: '0.250' });

function buildIssue(key, number, status, { link = null, epic = 'HAR-2030', description } = {}) {
  return {
    key,
    fields: {
      summary: `Test Assembly Build ${number}${description ? ` - ${description}` : ''}`,
      issuetype: { name: 'Build' },
      status: { name: status },
      customfield_10110: epic,
      customfield_10501: number,
      customfield_10502: link,
      issuelinks: [],
    },
  };
}

const isBuildList = (jql) => /issuetype = Build AND "Epic Link" in/.test(jql);
const isPartList = (jql) => /issuetype = Part AND "Epic Link" in/.test(jql);
const linkedTo = (key) => (jql) => jql.includes(`linkedIssues(${key},`);
const isKeyList = (jql) => /issuetype = Part AND key in/.test(jql) || /key in \(/.test(jql);

function jiraFor({ parts = [P2031, P2032, P2033], builds = [], links = {}, extraIssues = {}, fail = {}, nextKeys = [] } = {}) {
  const issues = { 'HAR-2030': assemblyIssue, ...extraIssues };
  for (const p of parts) issues[p.key] = p;
  for (const b of builds) issues[b.key] = b;
  return new FakeJira({
    issues,
    fail,
    nextKeys,
    search: [
      { match: isBuildList, issues: () => builds },
      { match: isPartList, issues: () => parts },
      ...Object.entries(links).map(([buildKey, keys]) => ({
        match: linkedTo(buildKey),
        issues: () => keys.map((k) => ({ key: k, fields: { summary: issues[k]?.fields?.summary } })),
      })),
      // A key list answers only the Parts it names.
      {
        match: isKeyList,
        issues: (jql) => {
          const named = new Set((/key in \(([^)]*)\)/.exec(jql)?.[1] ?? '').split(',').map((k) => k.trim().replace(/"/g, '')));
          return parts.filter((p) => named.has(p.key));
        },
      },
    ],
  });
}

function services(jira, onshape = fakeOnshape()) {
  const revisionService = new RevisionService({ jiraClient: jira });
  const bomService = new BOMService({ onshapeClient: onshape });
  const partService = new PartService({ jiraClient: jira, bomService, revisionService });
  const buildService = new BuildService({ jiraClient: jira, onshapeClient: onshape, revisionService, partService });
  const epicService = new EpicService({ jiraClient: jira, onshapeClient: onshape, buildService });
  return { revisionService, bomService, partService, buildService, epicService };
}

/** The POST /api/builds route's composition (buildRoutes.js). */
async function createBuildRoute(buildService, body) {
  const build = await buildService.createBuild(body);
  let linked = [];
  let failed = [];
  let cloneError = null;
  if (body.cloneFromBuildKey) {
    try {
      ({ linked, failed } = await buildService.cloneBuildParts(body.cloneFromBuildKey, build.key));
    } catch (err) {
      const { describeUpstreamError } = await import('../../src/server/utils/upstreamError.js');
      cloneError = describeUpstreamError(err);
    }
  }
  return { build, linked, failed, cloneError };
}

// ---------------------------------------------------------------------------
// BOM
// ---------------------------------------------------------------------------

async function rawBom() {
  const bom = JSON.parse(await fs.readFile(path.join(__dirname, 'raw', 'bom-har2030.json'), 'utf8'));
  const [first] = bom.bomTable.items;
  const row = (over) => ({
    ...clone(first),
    itemSource: { ...first.itemSource, partId: `J${over.item}`, rowId: `row-${over.item}` },
    ...over,
  });
  const material = (displayName) => ({ id: displayName, displayName, libraryName: 'Onshape Material Library' });
  bom.bomTable.items = [
    row({ item: '1', quantity: 3 }), // Test Part, quantity changed in CAD (1 -> 3)
    row({ item: '2', name: 'Plate', partNumber: '0002', quantity: 2, material: material('Aluminum - 6061') }),
    row({ item: '3', name: 'Bracket', partNumber: '0005', revision: '', quantity: 1 }), // missing Revision
    row({ item: '4', name: 'Spacer', partNumber: '0004', quantity: 4, material: material('PETG-CF') }),
    row({ item: '5', name: 'Shaft', partNumber: '0006', quantity: 1, material: material('Steel') }),
    row({ item: '6', name: 'Construction sketch body', partNumber: '', revision: '', excludeFromBom: true }),
  ];
  return bom;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export async function makeBomFixtures() {
  const f = {};
  const bom = await rawBom();

  const b1Draft = buildIssue('HAR-2051', 1, 'Draft');
  const b2Active = buildIssue('HAR-2052', 2, 'Active', { link: LINK_THIS_DOC });
  const b1ActiveThisDoc = buildIssue('HAR-2051', 1, 'Active', { link: LINK_THIS_DOC });
  const b2ActiveOtherDoc = buildIssue('HAR-2052', 2, 'Active', { link: LINK_OTHER_DOC });
  const b2Draft = buildIssue('HAR-2052', 2, 'Draft');
  const twoBuildLinks = { 'HAR-2051': ['HAR-2031', 'HAR-2032'], 'HAR-2052': ['HAR-2033'] };

  // ----- Reads -----
  {
    const s = services(jiraFor());
    f['epic-HAR-2030'] = await capture(() => s.epicService.getEpicByKey('HAR-2030'));
    f['chain-HAR-2030'] = await capture(() => s.revisionService.getRevisionChain('HAR-2030'));
    f['stories-chain-HAR-2030'] = await capture(async () => (await s.partService.getStoriesForChain('HAR-2030')).stories);
    f['epic-HAR-9-404'] = await capture(() => s.epicService.getEpicByKey('HAR-9'));
    f['chain-HAR-9-404'] = await capture(() => s.revisionService.getRevisionChain('HAR-9'));
    f['stories-chain-HAR-9-404'] = await capture(async () => (await s.partService.getStoriesForChain('HAR-9')).stories);
  }
  {
    const s = services(jiraFor({ parts: [P2031] }));
    f['stories-chain-one'] = await capture(async () => (await s.partService.getStoriesForChain('HAR-2030')).stories);
  }
  {
    const s = services(jiraFor({ fail: { getIssue: (key) => (key === 'HAR-2030' ? tracker503('/rest/api/2/issue/HAR-2030') : null) } }));
    f['epic-HAR-2030-503'] = await capture(() => s.epicService.getEpicByKey('HAR-2030'));
  }
  {
    const s = services(jiraFor({ builds: [] }));
    f['builds-none'] = await capture(() => s.buildService.getBuildsForAssemblies(['HAR-2030']));
    f['build-parts-empty'] = await capture(() => s.buildService.getLinkedParts('HAR-2051'));
  }
  {
    const s = services(jiraFor({ builds: [b2Active, b1Draft], links: twoBuildLinks }));
    f['builds-two'] = await capture(() => s.buildService.getBuildsForAssemblies(['HAR-2030']));
    f['build-parts-HAR-2051'] = await capture(() => s.buildService.getLinkedParts('HAR-2051'));
    f['build-parts-HAR-2052'] = await capture(() => s.buildService.getLinkedParts('HAR-2052'));
  }
  {
    const s = services(jiraFor({ fail: { search: (jql) => (isBuildList(jql) ? tracker503() : null) } }));
    f['builds-503'] = await capture(() => s.buildService.getBuildsForAssemblies(['HAR-2030']));
  }
  {
    const s = services(jiraFor({ builds: [b2ActiveOtherDoc, b1ActiveThisDoc] }));
    f['builds-two-active'] = await capture(() => s.buildService.getBuildsForAssemblies(['HAR-2030']));
    f['status-both-active'] = await capture(() => s.buildService.getBuildStatuses(['HAR-2052', 'HAR-2051']));
  }
  {
    const s = services(jiraFor({ builds: [buildIssue('HAR-2052', 2, 'Superseded', { link: LINK_OTHER_DOC }), b1ActiveThisDoc] }));
    f['status-2052-superseded'] = await capture(() => s.buildService.getBuildStatuses(['HAR-2052', 'HAR-2051']));
  }
  {
    const s = services(jiraFor({ builds: [b2ActiveOtherDoc, buildIssue('HAR-2051', 1, 'Superseded', { link: LINK_THIS_DOC })] }));
    f['status-2051-superseded'] = await capture(() => s.buildService.getBuildStatuses(['HAR-2052', 'HAR-2051']));
  }
  {
    const s = services(jiraFor({ fail: { getIssue: (key) => (key.startsWith('HAR-205') ? tracker503('/rest/api/2/issue') : null) } }));
    f['status-503'] = await capture(() => s.buildService.getBuildStatuses(['HAR-2052', 'HAR-2051']));
  }
  {
    // Build 1 Active (this document), Build 2 Draft: the finish-cut case.
    const s = services(jiraFor({ builds: [b2Draft, b1ActiveThisDoc] }));
    f['builds-active-and-draft'] = await capture(() => s.buildService.getBuildsForAssemblies(['HAR-2030']));
    const both = services(jiraFor({ builds: [buildIssue('HAR-2052', 2, 'Active', { link: LINK_THIS_DOC }), b1ActiveThisDoc] }));
    f['status-both-active-this-doc'] = await capture(() => both.buildService.getBuildStatuses(['HAR-2052', 'HAR-2051']));
  }

  // ----- Update from CAD -----
  const previewArgs = { epicKey: 'HAR-2030', documentId: DOC, workspaceId: WS, elementId: EL, fresh: true };
  {
    const s = services(jiraFor(), fakeOnshape({ bom }));
    f['preview-HAR-2030'] = await capture(() => s.partService.previewParts(previewArgs));
  }
  {
    const s = services(jiraFor(), fakeOnshape({ bom, fail: { bom: () => new OnshapeApiError('Bad Gateway', 502, '/assemblies/bom') } }));
    f['preview-onshape-502'] = await capture(() => s.partService.previewParts(previewArgs));
  }
  {
    const noRevision = clone(bom);
    noRevision.bomTable.headers = noRevision.bomTable.headers.filter((h) => h.propertyName !== 'name');
    const s = services(jiraFor(), fakeOnshape({ bom: noRevision }));
    f['preview-missing-columns'] = await capture(() => s.partService.previewParts(previewArgs));
  }

  // ----- Save -----
  {
    const s = services(jiraFor({ builds: [b1Draft], links: { 'HAR-2051': [] } }));
    f['save-link-HAR-2031'] = await capture(() => s.buildService.saveBuildParts({
      buildKey: 'HAR-2051', links: [{ ref: 'HAR-2031', key: 'HAR-2031' }],
    }));
  }
  {
    // After CAD: Spacer created but its link fails; Test Part quantity updated.
    const s = services(jiraFor({
      builds: [b2Active, b1Draft],
      links: twoBuildLinks,
      nextKeys: ['HAR-2034'],
      fail: { createIssueLink: (type, build, part) => (part === 'HAR-2034' ? tracker503('/rest/api/2/issueLink') : null) },
    }));
    f['save-after-cad-partial'] = await capture(() => s.buildService.saveBuildParts({
      buildKey: 'HAR-2051',
      creates: [{ ref: 'VF27P-0004A', summary: 'VF27P-0004A Spacer', revision: 'A', quantity: 4, material: 'PETG-CF', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' }],
      updates: [{ ref: 'HAR-2031', key: 'HAR-2031', quantity: 3, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None', link: false }],
    }));
  }
  {
    // The Retry for that row: a link only, for the Part the create made.
    const P2034 = partIssue('HAR-2034', 'VF27P-0004A Spacer', { qty: 4, material: 'PETG-CF' });
    const s = services(jiraFor({ parts: [P2031, P2032, P2033, P2034], builds: [b2Active, b1Draft], links: twoBuildLinks }));
    f['save-link-HAR-2034'] = await capture(() => s.buildService.saveBuildParts({
      buildKey: 'HAR-2051', links: [{ ref: 'HAR-2034', key: 'HAR-2034' }],
    }));
  }
  {
    const s = services(jiraFor({ fail: { getIssue: (key) => (key === 'HAR-2051' ? tracker503('/rest/api/2/issue/HAR-2051') : null) } }));
    f['save-503'] = await capture(() => s.buildService.saveBuildParts({
      buildKey: 'HAR-2051', updates: [{ ref: 'HAR-2031', key: 'HAR-2031', quantity: 3, material: 'PLA', machinery: '3D Printer' }],
    }));
  }

  // ----- New Build -----
  {
    const s = services(jiraFor({ builds: [], nextKeys: ['HAR-2051'] }));
    f['create-build-1'] = await capture(() => createBuildRoute(s.buildService, { assemblyKey: 'HAR-2030', revisionChainKeys: ['HAR-2030'], name: 'Test Assembly' }));
  }
  {
    const s = services(jiraFor({ builds: [b2Active, b1Draft], nextKeys: ['HAR-2053'] }));
    f['create-build-3-desc'] = await capture(() => createBuildRoute(s.buildService, { assemblyKey: 'HAR-2030', revisionChainKeys: ['HAR-2030'], name: 'Test Assembly', description: '1in bash bar' }));
  }
  {
    const s = services(jiraFor({
      builds: [b2Active, b1Draft],
      links: twoBuildLinks,
      nextKeys: ['HAR-2053'],
      fail: { createIssueLink: (type, build, part) => (part === 'HAR-2032' ? tracker503('/rest/api/2/issueLink') : null) },
    }));
    f['create-build-clone-partial'] = await capture(() => createBuildRoute(s.buildService, { assemblyKey: 'HAR-2030', revisionChainKeys: ['HAR-2030'], name: 'Test Assembly', cloneFromBuildKey: 'HAR-2051' }));
  }
  {
    const s = services(jiraFor({ builds: [b2Active, b1Draft], fail: { createIssue: () => tracker503('/rest/api/2/issue') } }));
    f['create-build-503'] = await capture(() => createBuildRoute(s.buildService, { assemblyKey: 'HAR-2030', revisionChainKeys: ['HAR-2030'], name: 'Test Assembly' }));
  }

  // ----- Cut Version -----
  const cut = (jira, buildKey = 'HAR-2051', onshape = fakeOnshape()) => capture(
    () => services(jira, onshape).buildService.cutVersionFromOnshape({ buildKey, assemblyKey: 'HAR-2030' }),
  );
  f['cut-ok'] = await cut(jiraFor({ builds: [b2Active, b1Draft] }));
  f['cut-onshape-502'] = await cut(jiraFor({ builds: [b2Active, b1Draft] }),
    'HAR-2051', fakeOnshape({ fail: { createVersion: () => new OnshapeApiError('Bad Gateway', 502, '/documents/versions') } }));
  f['cut-409-superseded'] = await cut(jiraFor({ builds: [b2Active, buildIssue('HAR-2051', 1, 'Superseded', { link: LINK_THIS_DOC })] }));
  f['cut-stage-link'] = await cut(jiraFor({ builds: [b2Active, b1Draft], fail: { updateIssue: () => tracker503('/rest/api/2/issue/HAR-2051') } }));
  f['cut-stage-supersede'] = await cut(jiraFor({
    builds: [b2Active, b1Draft],
    fail: { transitionIssue: (key, id) => (key === 'HAR-2052' && String(id) === '21' ? tracker503('/rest/api/2/issue/HAR-2052/transitions') : null) },
  }));
  // Build 2 cut while Build 1 is Active; superseding Build 1 fails.
  f['cut-2052-stage-supersede'] = await cut(jiraFor({
    builds: [b2Draft, b1ActiveThisDoc],
    fail: { transitionIssue: (key, id) => (key === 'HAR-2051' && String(id) === '21' ? tracker503('/rest/api/2/issue/HAR-2051/transitions') : null) },
  }), 'HAR-2052');
  // Two-Active repair: Build 1 (this document) resumes and supersedes Build 2.
  f['cut-repair-resumed'] = await cut(jiraFor({ builds: [b2ActiveOtherDoc, b1ActiveThisDoc] }));
  f['cut-repair-409'] = await cut(jiraFor({ builds: [b2ActiveOtherDoc, buildIssue('HAR-2051', 1, 'Superseded', { link: LINK_THIS_DOC })] }));

  // ----- Assembly page (INC-7) -----
  const b1Superseded = buildIssue('HAR-2051', 1, 'Superseded', { link: LINK_THIS_DOC });
  const b3Draft = buildIssue('HAR-2053', 3, 'Draft');
  const threeBuilds = [b1Superseded, b2Active, b3Draft];
  const fourParts = [P2031, P2032, P2033, P2035];
  const threeLinks = { 'HAR-2051': ['HAR-2031', 'HAR-2032'], 'HAR-2052': ['HAR-2031', 'HAR-2033'], 'HAR-2053': ['HAR-2031', 'HAR-2035'] };
  {
    const s = services(jiraFor({ parts: fourParts, builds: threeBuilds, links: threeLinks }));
    f['builds-three'] = await capture(() => s.buildService.getBuildsForAssemblies(['HAR-2030']));
    f['stories-chain-four'] = await capture(async () => (await s.partService.getStoriesForChain('HAR-2030')).stories);
    for (const k of Object.keys(threeLinks)) {
      f[`build-parts-a-${k}`] = await capture(() => s.buildService.getLinkedParts(k));
    }
    f['archive-ok'] = await capture(async () => {
      await s.buildService.archiveBuild('HAR-2053');
      return { success: true };
    });
  }
  {
    // Designer: Draft Build 1 holds HAR-2031 and HAR-2033; Active Build 2
    // also uses HAR-2033, so its fields are locked.
    const sharedLinks = { 'HAR-2051': ['HAR-2031', 'HAR-2033'], 'HAR-2052': ['HAR-2033'] };
    const s = services(jiraFor({ builds: [b2Active, b1Draft], links: sharedLinks, nextKeys: ['HAR-2041'] }));
    f['build-parts-HAR-2051-shared'] = await capture(() => s.buildService.getLinkedParts('HAR-2051'));
  }
  {
    const s = services(jiraFor({ parts: fourParts, builds: threeBuilds, links: threeLinks, nextKeys: ['HAR-2040'] }));
    f['clone-HAR-2032-ok'] = await capture(() => s.partService.clonePart({
      sourceKey: 'HAR-2032', epicKey: 'HAR-2030', quantity: 1,
    }));
  }

  Object.assign(f, await makeHomeFixtures());
  return f;
}

// ---------------------------------------------------------------------------
// Home: search and onboarding (INC-8)
// ---------------------------------------------------------------------------

function assemblyListIssue(key, summary, created, { status = 'New', ids = null } = {}) {
  return {
    key,
    fields: {
      summary,
      issuetype: { name: 'Assembly' },
      status: { name: status },
      created,
      customfield_10500: /^V[RF]\d{2}A-\d{4}([A-Z])\s/.exec(summary)?.[1] ?? null,
      ...(ids ? { customfield_10300: ids.doc, customfield_10301: ids.ws, customfield_10302: ids.el } : {}),
    },
  };
}

const OPEN_ASSEMBLIES = [
  { ...assemblyIssue, fields: { ...assemblyIssue.fields, issuetype: { name: 'Assembly' } } },
  assemblyListIssue('HAR-1984', 'VF27-0200 Tooling', '2026-10-20T15:00:00.000+0000'),
  assemblyListIssue('HAR-1983', 'VF27A-0101A Pit Cart', '2026-10-18T15:00:00.000+0000'),
  assemblyListIssue('HAR-1981', 'VR27A-0300A Intake', '2026-10-15T15:00:00.000+0000'),
  assemblyListIssue('HAR-1979', 'VR26-1200A End Effector', '2026-02-10T15:00:00.000+0000'),
  assemblyListIssue('HAR-1974', 'Bumper mounts', '2026-01-20T15:00:00.000+0000'),
  assemblyListIssue('HAR-1972', 'Second end effector', '2026-01-12T15:00:00.000+0000'),
];
const CLOSED_ASSEMBLY = assemblyListIssue('HAR-1990', 'VF27A-0900A Old Intake', '2026-03-01T15:00:00.000+0000', { status: 'Closed' });

function searchJira({ open = OPEN_ASSEMBLIES, closed = [CLOSED_ASSEMBLY], fail } = {}) {
  const issues = Object.fromEntries([...open, ...closed].map((i) => [i.key, i]));
  return new FakeJira({
    issues,
    fail: fail ?? {},
    search: [
      { match: (jql) => /issuetype = Assembly AND status not in/.test(jql), issues: () => open },
      { match: (jql) => /issuetype = Assembly ORDER BY/.test(jql), issues: () => [...open, ...closed] },
    ],
  });
}

const PROPERTY_IDS = {
  Name: '57f3fb8efa3416c06701d60d',
  'Part number': '57f3fb8efa3416c06701d60f',
  Revision: '57f3fb8efa3416c06701d610',
  Project: '57f3fb8efa3416c06701d613',
};

function assemblyMetadata(values) {
  return {
    mimeType: 'onshape/assembly',
    elementType: 1,
    properties: Object.entries(values).map(([name, value]) => ({ propertyId: PROPERTY_IDS[name], name, value })),
  };
}

const TEST_ASSEMBLY_PROPS = { Project: 'VF27', 'Part number': '0000', Revision: 'A', Name: 'Test Assembly' };
export const ONBOARD_URL = `${ONSHAPE}/documents/${DOC}/w/${WS}/e/${EL}`;

/** A tracker with no Assembly for this element yet, ready to onboard. */
function onboardJira({ elementHits = [], numberHits = [], fail = {} } = {}) {
  return new FakeJira({
    fail,
    nextKeys: ['HAR-2030', 'HAR-2051'],
    search: [
      { match: (jql) => jql.includes('cf[10302] ~'), issues: () => elementHits },
      { match: (jql) => jql.includes('summary ~ "\\"'), issues: () => numberHits },
      { match: isBuildList, issues: () => [] },
    ],
  });
}

async function makeHomeFixtures() {
  const f = {};

  // ----- Search -----
  {
    const s = services(searchJira());
    f['search-empty'] = await capture(() => s.epicService.searchAssemblies('', {}));
    f['search-0000'] = await capture(() => s.epicService.searchAssemblies('0000', {}));
    f['search-facility-2027'] = await capture(() => s.epicService.searchAssemblies('facility 2027', {}));
    f['search-bash'] = await capture(() => s.epicService.searchAssemblies('bash', {}));
    f['search-empty-closed'] = await capture(() => s.epicService.searchAssemblies('', { includeClosed: true }));
    f['search-HAR-1990'] = await capture(() => s.epicService.searchAssemblies('HAR-1990', {}));
  }
  {
    const s = services(searchJira({ open: [], closed: [] }));
    f['search-none'] = await capture(() => s.epicService.searchAssemblies('', {}));
  }
  {
    const s = services(searchJira({ fail: { search: () => tracker503() } }));
    f['search-503'] = await capture(() => s.epicService.searchAssemblies('', {}));
  }

  // ----- Onboarding preview -----
  const props = assemblyMetadata(TEST_ASSEMBLY_PROPS);
  {
    const s = services(onboardJira(), fakeOnshape({ metadata: props }));
    f['onboard-preview-new'] = await capture(() => s.epicService.previewOnboarding(ONBOARD_URL));
  }
  {
    const s = services(onboardJira({ elementHits: [assemblyIssue] }), fakeOnshape({ metadata: props }));
    f['onboard-preview-exists'] = await capture(() => s.epicService.previewOnboarding(ONBOARD_URL));
  }
  {
    const other = assemblyListIssue('HAR-2040', 'VF27A-0000A Old Test', '2026-09-01T15:00:00.000+0000', {
      ids: { doc: '0a1b2c3d4e5f60718293a4b5', ws: '1b2c3d4e5f60718293a4b5c6', el: '1234567890abcdef12345678' },
    });
    const s = services(onboardJira({ numberHits: [other] }), fakeOnshape({ metadata: props }));
    f['onboard-preview-conflict'] = await capture(() => s.epicService.previewOnboarding(ONBOARD_URL));
  }
  {
    const s = services(onboardJira(), fakeOnshape({ metadata: assemblyMetadata({ ...TEST_ASSEMBLY_PROPS, Project: '', 'Part number': '12' }) }));
    f['onboard-preview-problems'] = await capture(() => s.epicService.previewOnboarding(ONBOARD_URL));
  }
  {
    const s = services(onboardJira(), fakeOnshape({ fail: { metadata: () => new OnshapeApiError('Bad Gateway', 502, '/metadata') } }));
    f['onboard-preview-onshape-502'] = await capture(() => s.epicService.previewOnboarding(ONBOARD_URL));
  }

  // ----- Onboarding commit -----
  const expectedSummary = 'VF27A-0000A Test Assembly';
  {
    const s = services(onboardJira(), fakeOnshape({ metadata: props }));
    f['onboard-created'] = await capture(() => s.epicService.onboardAssembly({ url: ONBOARD_URL, expectedSummary }));
  }
  {
    const s = services(onboardJira({
      fail: { createIssue: (fields) => (fields.issuetype?.name === 'Build' ? tracker503('/rest/api/2/issue') : null) },
    }), fakeOnshape({ metadata: props }));
    f['onboard-created-build-failed'] = await capture(() => s.epicService.onboardAssembly({ url: ONBOARD_URL, expectedSummary }));
  }
  {
    // A double submit: the second call waits for the first and answers "exists".
    const s = services(onboardJira(), fakeOnshape({ metadata: props }));
    const args = { url: ONBOARD_URL, expectedSummary };
    const [, second] = await Promise.all([
      capture(() => s.epicService.onboardAssembly(args)),
      capture(() => s.epicService.onboardAssembly(args)),
    ]);
    f['onboard-exists-commit'] = second;
  }
  {
    const s = services(onboardJira(), fakeOnshape({ metadata: assemblyMetadata({ ...TEST_ASSEMBLY_PROPS, Name: 'Test Assembly v2' }) }));
    f['onboard-drift-409'] = await capture(() => s.epicService.onboardAssembly({ url: ONBOARD_URL, expectedSummary }));
  }
  // The service stamps "now" on a just-created Assembly; pin it so the
  // fixtures don't change on every regeneration.
  for (const name of ['onboard-created', 'onboard-created-build-failed', 'onboard-exists-commit']) {
    if (f[name].body.assembly) f[name].body.assembly.created = '2026-10-30T15:00:00.000Z';
  }

  return f;
}

export function checkHomeFixtures(f, assert) {
  const empty = f['search-empty'].body;
  assert(empty.groups?.length >= 3 && empty.groups.at(-1).label === 'Other', `search-empty groups: ${JSON.stringify(empty.groups)}`);
  assert(empty.groups[0].label === 'Robot 2027' && empty.groups[1].label === 'Facility 2027', 'search-empty group order');
  assert(f['search-0000'].body.results.map((a) => a.key).join() === 'HAR-2030', 'search 0000');
  assert(f['search-facility-2027'].body.total === 3, 'search facility 2027');
  assert(f['search-bash'].body.total === 0, 'search bash');
  assert(f['search-none'].body.total === 0, 'search none');
  assert(f['search-empty-closed'].body.results.some((a) => a.key === 'HAR-1990' && a.closed), 'search closed');
  const byKey = f['search-HAR-1990'].body;
  assert(byKey.total === 1 && byKey.results[0].closed === true, `search by key: ${JSON.stringify(byKey)}`);
  assert(f['search-503'].status === 503 && f['search-503'].body.source === 'tracker', 'search 503');
  assert(f['onboard-preview-new'].body.status === 'new' && f['onboard-preview-new'].body.proposed.summary === 'VF27A-0000A Test Assembly', 'preview new');
  assert(f['onboard-preview-exists'].body.status === 'exists' && f['onboard-preview-exists'].body.assembly.key === 'HAR-2030', 'preview exists');
  assert(f['onboard-preview-conflict'].status === 409 && f['onboard-preview-conflict'].body.assembly.key === 'HAR-2040', 'preview conflict');
  assert(f['onboard-preview-problems'].status === 400 && f['onboard-preview-problems'].body.problems.length === 2, 'preview problems');
  assert(f['onboard-preview-onshape-502'].body.source === 'onshape', 'preview 502');
  const created = f['onboard-created'].body;
  assert(created.status === 'created' && created.assembly.key === 'HAR-2030' && created.build?.key === 'HAR-2051', `onboard created: ${JSON.stringify(created)}`);
  const failed = f['onboard-created-build-failed'].body;
  assert(failed.status === 'created' && failed.build === null && failed.buildError, 'onboard build failed');
  const exists = f['onboard-exists-commit'].body;
  assert(exists.status === 'exists' && exists.build?.key === 'HAR-2051', `onboard exists: ${JSON.stringify(exists)}`);
  assert(f['onboard-drift-409'].status === 409 && f['onboard-drift-409'].body.proposed?.summary === 'VF27A-0000A Test Assembly v2', 'onboard drift');
}

/** Shape checks that make-fixtures runs before writing. */
export function checkBomFixtures(f, assert) {
  assert(f['epic-HAR-2030'].body.key === 'HAR-2030' && f['epic-HAR-2030'].body.onshapeUrl, 'epic fixture lacks key or onshapeUrl');
  assert(f['epic-HAR-9-404'].status === 404, 'HAR-9 epic is not a 404');
  assert(f['epic-HAR-2030-503'].body.source === 'tracker', 'epic 503 has no tracker source');
  assert(f['stories-chain-HAR-2030'].body.length === 3, 'chain Parts fixture is not 3 Parts');
  assert(f['builds-two'].body.length === 2, 'builds-two is not two Builds');
  const preview = f['preview-HAR-2030'].body;
  assert(preview.newParts.map((p) => p.fullPartNumber).sort().join() === 'VF27P-0004A,VF27P-0006A', `preview newParts: ${preview.newParts.map((p) => p.fullPartNumber)}`);
  assert(preview.unidentified.length === 1, 'preview has no unidentified row');
  assert(preview.newParts.find((p) => p.fullPartNumber === 'VF27P-0006A').material === 'Steel', 'Steel row lost its material');
  assert(f['preview-onshape-502'].body.source === 'onshape', 'preview 502 has no onshape source');
  assert(f['save-link-HAR-2031'].body.results[0].ok === true, 'link save did not succeed');
  const partial = f['save-after-cad-partial'].body.results;
  assert(partial.find((r) => r.ref === 'VF27P-0004A')?.ok === false && partial.find((r) => r.ref === 'VF27P-0004A').key === 'HAR-2034', 'partial save create result');
  assert(f['save-503'].status === 503, 'save-503 is not 503');
  assert(f['save-link-HAR-2034'].body.results[0].ok === true, 'retry link save did not succeed');
  assert(f['create-build-1'].body.build.key === 'HAR-2051', 'create-build-1 key');
  assert(f['create-build-3-desc'].body.build.summary === 'Test Assembly Build 3 - 1in bash bar', 'create-build-3-desc summary');
  assert(f['create-build-clone-partial'].body.failed.length === 1, 'clone partial has no failure');
  assert(f['cut-ok'].body.superseded.join() === 'HAR-2052', 'cut-ok superseded');
  assert(f['cut-409-superseded'].body.buildStatus === 'Superseded' && f['cut-409-superseded'].status === 409, 'cut 409 body');
  assert(f['cut-stage-link'].body.cutStage === 'link', 'cut-stage-link');
  assert(f['cut-stage-supersede'].body.cutStage === 'supersede' && f['cut-stage-supersede'].body.onshapeVersionLink, 'cut-stage-supersede');
  assert(f['cut-2052-stage-supersede'].body.cutStage === 'supersede', 'cut-2052-stage-supersede');
  assert(f['cut-repair-resumed'].body.resumed === true && f['cut-repair-resumed'].body.superseded.join() === 'HAR-2052', 'cut-repair-resumed');
  assert(f['cut-repair-409'].status === 409, 'cut-repair-409');
  assert(f['status-503'].status === 503, 'status-503');
  assert(f['builds-three'].body.length === 3, 'builds-three is not three Builds');
  assert(f['stories-chain-four'].body.length === 4, 'stories-chain-four is not four Parts');
  assert(f['build-parts-a-HAR-2053'].body.join() === 'HAR-2031,HAR-2035', 'Build 3 Parts');
  assert(f['build-parts-HAR-2051-shared'].body.join() === 'HAR-2031,HAR-2033', 'shared Draft Parts');
  assert(f['clone-HAR-2032-ok'].body.key === 'HAR-2040' && f['clone-HAR-2032-ok'].body.part?.key === 'HAR-2040', 'clone ok');
  assert(f['archive-ok'].body.success === true, 'archive ok');
  checkHomeFixtures(f, assert);
}
