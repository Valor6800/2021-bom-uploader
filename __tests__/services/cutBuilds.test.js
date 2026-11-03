/**
 * Cut Builds are immutable: every write path that would change a cut
 * Build's Parts, or the fields of a Part a cut Build uses, answers 409 and
 * writes nothing. The real services and routes run against a fake tracker
 * whose Build statuses are read by key.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const { apiNotFound, errorHandler } = await import('../../src/server/middleware/errorHandler.js');
const { default: buildRoutes } = await import('../../src/server/routes/buildRoutes.js');
const { default: partRoutes } = await import('../../src/server/routes/partRoutes.js');
const { BuildService } = await import('../../src/server/services/buildService.js');
const { PartService } = await import('../../src/server/services/partService.js');
const { RevisionService } = await import('../../src/server/services/revisionService.js');
const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
const { BuildField, BuildTransition, LinkType } = await import('../../src/server/utils/buildConstants.js');

const savedProject = process.env.PROJECT_KEY;
beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });
afterAll(() => {
  if (savedProject === undefined) delete process.env.PROJECT_KEY;
  else process.env.PROJECT_KEY = savedProject;
});

const ASSEMBLY = 'HAR-2030';
const VALUES = { quantity: 2, material: 'AL 6061', machinery: 'CNC Mill', powdercoat: 'None', thickness: 'None' };

/**
 * Builds 1 (Active), 2 (Draft), 3 (Superseded), 4 (Archived), 5 (Draft).
 * HAR-2031 is in cut Build 1 and Draft Build 2; HAR-2032 only in Build 2;
 * HAR-2033 in cut Builds 1 and 3.
 */
function makeWorld() {
  const builds = {
    'HAR-2051': { n: 1, status: 'Active' },
    'HAR-2052': { n: 2, status: 'Draft' },
    'HAR-2053': { n: 3, status: 'Superseded' },
    'HAR-2054': { n: 4, status: 'Archived' },
    'HAR-2055': { n: 5, status: 'Draft' },
  };
  const parts = {
    'HAR-2031': { summary: 'VF27P-0001A Spacer', builds: ['HAR-2051', 'HAR-2052'] },
    'HAR-2032': { summary: 'VF27P-0002A Plate', builds: ['HAR-2052'] },
    'HAR-2033': { summary: 'VF27P-0003A Bracket', builds: ['HAR-2051', 'HAR-2053'] },
  };
  let next = 3000;

  const buildIssue = (key) => ({
    key,
    fields: {
      issuetype: { name: 'Build' },
      summary: `Intake Build ${builds[key].n}`,
      status: { name: builds[key].status },
      [BuildField.BUILD_NUMBER]: builds[key].n,
      [BuildField.ASSEMBLY_LINK]: ASSEMBLY,
    },
  });
  const partIssue = (key) => ({
    key,
    fields: {
      issuetype: { name: 'Part' },
      summary: parts[key].summary,
      project: { key: 'HAR' },
      customfield_10110: ASSEMBLY,
      customfield_10500: 'A',
      customfield_10201: [{ value: VALUES.machinery }],
      customfield_10202: { value: VALUES.material },
      customfield_10206: VALUES.quantity,
      issuelinks: parts[key].builds.map((b) => ({ type: { name: LinkType.USED_IN }, inwardIssue: { key: b } })),
    },
  });

  const jiraClient = {
    getIssue: jest.fn(async (key) => {
      if (builds[key]) return buildIssue(key);
      if (parts[key]) return partIssue(key);
      if (key === ASSEMBLY) return { key, fields: { issuetype: { name: 'Epic' }, summary: 'VF27A-0001A Intake', issuelinks: [] } };
      throw new JiraApiError('Issue does not exist', 404, 'getIssue');
    }),
    searchIssues: jest.fn(async (jql) => {
      const linked = jql.match(/linkedIssues\((HAR-\d+)/);
      if (linked) {
        const key = linked[1];
        if (builds[key]) return Object.keys(parts).filter((p) => parts[p].builds.includes(key)).map(partIssue);
        return (parts[key]?.builds ?? []).map(buildIssue);
      }
      const inKeys = jql.match(/key in \(([^)]+)\)/);
      if (inKeys) return inKeys[1].split(', ').filter((k) => parts[k]).map(partIssue);
      if (jql.includes('issuetype = Build')) return Object.keys(builds).map(buildIssue);
      return Object.keys(parts).map(partIssue);
    }),
    createIssue: jest.fn(async (fields) => {
      const key = `HAR-${next++}`;
      if (fields.issuetype?.name === 'Build') builds[key] = { n: fields[BuildField.BUILD_NUMBER], status: 'Draft' };
      return { key };
    }),
    updateIssue: jest.fn().mockResolvedValue(undefined),
    transitionIssue: jest.fn().mockResolvedValue(undefined),
    createIssueLink: jest.fn().mockResolvedValue(undefined),
  };

  const revisionService = new RevisionService({ jiraClient });
  jest.spyOn(revisionService, 'getRevisionChain').mockResolvedValue([ASSEMBLY]);
  const partService = new PartService({ jiraClient, revisionService });
  const buildService = new BuildService({ jiraClient, revisionService, partService });

  const app = express();
  app.use(express.json());
  app.use('/api/builds', buildRoutes({ buildService }));
  app.use('/api', partRoutes({ partService, exportService: {} }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  return { jiraClient, buildService, partService, revisionService, app };
}

function expectNoWrites(jiraClient) {
  expect(jiraClient.createIssue).not.toHaveBeenCalled();
  expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  expect(jiraClient.transitionIssue).not.toHaveBeenCalled();
  expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
}

const CUT_MESSAGE = (n) => `Build ${n} has been cut, so it can't be changed. Make a new Build from it instead.`;

let warn;
beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => warn.mockRestore());

describe('writes into a cut Build answer 409 and write nothing', () => {
  it.each([
    ['Active', 'HAR-2051', 1],
    ['Superseded', 'HAR-2053', 3],
    ['Archived', 'HAR-2054', 4],
  ])('POST /parts (Move to this Build) into an %s Build', async (status, key, n) => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post(`/api/builds/${key}/parts`).send({ partKey: 'HAR-2032' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: CUT_MESSAGE(n), buildStatus: status });
    expectNoWrites(jiraClient);
  });

  it.each([
    ['links', { links: [{ ref: 'a', key: 'HAR-2032' }] }],
    ['updates', { updates: [{ ref: 'a', key: 'HAR-2031', ...VALUES, quantity: 9 }] }],
    ['creates', { creates: [{ ref: 'VF27P-0009A', summary: 'VF27P-0009A New', revision: 'A', ...VALUES }] }],
  ])('the save endpoint refuses %s on a cut Build before any read of the Parts', async (_, body) => {
    const { app, jiraClient, partService } = makeWorld();
    const spy = jest.spyOn(partService, 'getStoriesByEpics');
    const res = await request(app).post('/api/builds/HAR-2051/save').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(CUT_MESSAGE(1));
    expect(spy).not.toHaveBeenCalled();
    expectNoWrites(jiraClient);
  });

  it('cloneBuildParts into a cut Build', async () => {
    const { buildService, jiraClient } = makeWorld();
    await expect(buildService.cloneBuildParts('HAR-2052', 'HAR-2051'))
      .rejects.toMatchObject({ status: 409, message: CUT_MESSAGE(1) });
    expectNoWrites(jiraClient);
  });

});

describe('field updates to a Part a cut Build uses answer 409 and write nothing', () => {
  it('a save update on a Draft for a Part shared with cut Build 1', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/builds/HAR-2052/save').send({
      updates: [{ ref: 'HAR-2031', key: 'HAR-2031', ...VALUES, quantity: 9, link: true }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([expect.objectContaining({
      ref: 'HAR-2031', op: 'update', ok: false, status: 409, locked: true,
      error: "VF27P-0001A is used in cut Build 1, so it can't be changed.",
      cutBuilds: [{ key: 'HAR-2051', buildNumber: 1, status: 'Active' }],
    })]);
    expectNoWrites(jiraClient);
  });

  it('a save create whose number matches a shared Part with different values', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/builds/HAR-2055/save').send({
      creates: [{ ref: 'VF27P-0001A', summary: 'VF27P-0001A Spacer', revision: 'A', ...VALUES, quantity: 9 }],
    });
    expect(res.body.results).toEqual([expect.objectContaining({
      op: 'create', ok: false, status: 409, locked: true, key: 'HAR-2031', reused: true,
    })]);
    expectNoWrites(jiraClient);
  });

  it('PUT /api/stories/:key names every cut Build', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).put('/api/stories/HAR-2033').send({ summary: 'VF27P-0003A Bracket', ...VALUES });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      "VF27P-0003A is used in cut Build 1, Build 3, so it can't be changed.",
    );
    expectNoWrites(jiraClient);
  });

  it('partService.updateStory itself refuses', async () => {
    const { partService, jiraClient } = makeWorld();
    await expect(partService.updateStory('HAR-2031', { summary: 'VF27P-0001A Spacer', ...VALUES }))
      .rejects.toMatchObject({ status: 409 });
    expectNoWrites(jiraClient);
  });
});

describe('still allowed', () => {
  it('Archive on a cut Build', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/builds/HAR-2051/archive');
    expect(res.status).toBe(200);
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('HAR-2051', BuildTransition.ARCHIVE);
  });

  it('a new Build copying Parts from a cut Build writes only to the new Draft', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/builds').send({
      assemblyKey: ASSEMBLY, name: 'Intake', cloneFromBuildKey: 'HAR-2051',
    });
    expect(res.status).toBe(200);
    expect(res.body.build).toMatchObject({ key: 'HAR-3000', status: 'Draft', buildNumber: 6 });
    expect(res.body.linked.sort()).toEqual(['HAR-2031', 'HAR-2033']);
    expect(jiraClient.createIssueLink).toHaveBeenCalledTimes(2);
    for (const [type, source] of jiraClient.createIssueLink.mock.calls) {
      expect([type, source]).toEqual([LinkType.USED_IN, 'HAR-3000']);
    }
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
    expect(jiraClient.transitionIssue).not.toHaveBeenCalled();
  });

  it('Clone a Part used in a cut Build makes a new Part with no Build link', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/parts/HAR-2031/clone').send({ epicKey: ASSEMBLY });
    expect(res.status).toBe(200);
    expect(jiraClient.createIssue).toHaveBeenCalledTimes(1);
    expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  });

  it('a save update for a Draft-only Part', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/builds/HAR-2052/save').send({
      updates: [{ ref: 'HAR-2032', key: 'HAR-2032', ...VALUES, quantity: 9 }],
    });
    expect(res.body.results).toEqual([expect.objectContaining({ op: 'update', ok: true })]);
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('HAR-2032', expect.objectContaining({ customfield_10206: 9 }));
  });

  it('PUT /api/stories/:key for a Draft-only Part', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).put('/api/stories/HAR-2032').send({ summary: 'VF27P-0002A Plate', ...VALUES });
    expect(res.status).toBe(200);
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('HAR-2032', expect.any(Object));
  });

  it('linking a Part shared with a cut Build into a Draft, without changing it', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/builds/HAR-2055/save').send({ links: [{ ref: 'a', key: 'HAR-2031' }] });
    expect(res.body.results).toEqual([expect.objectContaining({ op: 'link', ok: true, linked: true })]);
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-2055', 'HAR-2031');
  });

  it('a mixed save on a Draft fails only the locked item', async () => {
    const { app, jiraClient } = makeWorld();
    const res = await request(app).post('/api/builds/HAR-2052/save').send({
      updates: [
        { ref: 'a', key: 'HAR-2031', ...VALUES, quantity: 9 },
        { ref: 'b', key: 'HAR-2032', ...VALUES, quantity: 9 },
      ],
    });
    expect(res.body.results.map((r) => [r.ref, r.ok])).toEqual([['a', false], ['b', true]]);
    expect(jiraClient.updateIssue).toHaveBeenCalledTimes(1);
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('HAR-2032', expect.any(Object));
  });
});
