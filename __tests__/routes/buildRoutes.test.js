/**
 * Integration tests for Build routes — a minimal Express app wired like
 * src/server/index.js, with a mocked BuildService, exercised via supertest.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const { apiNotFound, errorHandler } = await import('../../src/server/middleware/errorHandler.js');
const { cors } = await import('../../src/server/middleware/cors.js');
const { default: buildRoutes } = await import('../../src/server/routes/buildRoutes.js');

// validateIssueKey reads the project at call time; pin it for these tests.
const savedProject = process.env.PROJECT_KEY;
beforeAll(() => { process.env.PROJECT_KEY = 'VAL'; });
afterAll(() => {
  if (savedProject === undefined) delete process.env.PROJECT_KEY;
  else process.env.PROJECT_KEY = savedProject;
});

function buildApp(buildService) {
  const app = express();
  app.use(cors);
  app.use(express.json());
  app.use('/api/builds', buildRoutes({ buildService }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}

describe('GET /api/builds', () => {
  it('requires assemblyKey', async () => {
    const app = buildApp({});
    const res = await request(app).get('/api/builds');
    expect(res.status).toBe(400);
  });

  it('defaults revisionChainKeys to just assemblyKey', async () => {
    const buildService = { getBuildsForAssemblies: jest.fn().mockResolvedValue([{ key: 'VAL-10' }]) };
    const app = buildApp(buildService);

    const res = await request(app).get('/api/builds?assemblyKey=VAL-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'VAL-10' }]);
    expect(buildService.getBuildsForAssemblies).toHaveBeenCalledWith(['VAL-1']);
  });

  it('splits a comma-separated revisionChainKeys', async () => {
    const buildService = { getBuildsForAssemblies: jest.fn().mockResolvedValue([]) };
    const app = buildApp(buildService);

    await request(app).get('/api/builds?assemblyKey=VAL-1&revisionChainKeys=VAL-1,%20VAL-1B');
    expect(buildService.getBuildsForAssemblies).toHaveBeenCalledWith(['VAL-1', 'VAL-1B']);
  });
});

describe('POST /api/builds', () => {
  const BUILD = {
    key: 'VAL-11', summary: 'Intake Build 2', assemblyKey: 'VAL-1',
    buildNumber: 2, status: 'Draft', onshapeVersionLink: null,
  };

  it('requires assemblyKey and name', async () => {
    const app = buildApp({});
    const res = await request(app).post('/api/builds').send({ assemblyKey: 'VAL-1' });
    expect(res.status).toBe(400);
  });

  it('creates a build without cloning when cloneFromBuildKey is omitted', async () => {
    const buildService = {
      createBuild: jest.fn().mockResolvedValue(BUILD),
      cloneBuildParts: jest.fn(),
    };
    const app = buildApp(buildService);

    const res = await request(app).post('/api/builds').send({ assemblyKey: 'VAL-1', name: 'Intake' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ build: BUILD, linked: [], failed: [], cloneError: null });
    expect(buildService.cloneBuildParts).not.toHaveBeenCalled();
  });

  it('clones parts from the given sibling when cloneFromBuildKey is set', async () => {
    const buildService = {
      createBuild: jest.fn().mockResolvedValue(BUILD),
      cloneBuildParts: jest.fn().mockResolvedValue({ linked: ['VAL-50'], failed: [] }),
    };
    const app = buildApp(buildService);

    const res = await request(app).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: 'Intake', cloneFromBuildKey: 'VAL-10',
    });

    expect(buildService.createBuild).toHaveBeenCalledWith(expect.objectContaining({ cloneFromBuildKey: 'VAL-10' }));
    expect(buildService.cloneBuildParts).toHaveBeenCalledWith('VAL-10', 'VAL-11');
    expect(res.body).toEqual({ build: BUILD, linked: ['VAL-50'], failed: [], cloneError: null });
  });

  it('answers 200 with the Build and cloneError when the clone throws', async () => {
    const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
    const buildService = {
      createBuild: jest.fn().mockResolvedValue(BUILD),
      cloneBuildParts: jest.fn().mockRejectedValue(new JiraApiError('down', 503, '/search')),
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(buildApp(buildService)).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: 'Intake', cloneFromBuildKey: 'VAL-10',
    });
    warn.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      build: BUILD, linked: [], failed: [], cloneError: "the team tracker didn't respond (503)",
    });
  });

  it('passes a foreign clone source 400 from the service through', async () => {
    const { badRequest } = await import('../../src/server/middleware/httpError.js');
    const buildService = {
      createBuild: jest.fn().mockRejectedValue(badRequest('"VAL-77" isn\'t a Build of this Assembly')),
      cloneBuildParts: jest.fn(),
    };
    const res = await request(buildApp(buildService)).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: 'Intake', cloneFromBuildKey: 'VAL-77',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('"VAL-77" isn\'t a Build of this Assembly');
    expect(buildService.cloneBuildParts).not.toHaveBeenCalled();
  });

  it('trims and collapses the description and passes it on', async () => {
    const buildService = { createBuild: jest.fn().mockResolvedValue(BUILD) };
    await request(buildApp(buildService)).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: ' Intake ', description: '  1in   bash bar ',
    });
    expect(buildService.createBuild).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Intake', description: '1in bash bar',
    }));
  });

  it('treats a whitespace-only description as absent', async () => {
    const buildService = { createBuild: jest.fn().mockResolvedValue(BUILD) };
    const res = await request(buildApp(buildService)).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: 'Intake', description: '   ',
    });
    expect(res.status).toBe(200);
    expect(buildService.createBuild.mock.calls[0][0].description).toBeUndefined();
  });

  it.each([
    ['a 61-character description', { description: 'x'.repeat(61) }, 'description'],
    ['a number description', { description: 12 }, 'description'],
    ['a control character in description', { description: 'bash\u0007bar' }, 'description'],
    ['a malformed assemblyKey', { assemblyKey: 'val-1' }, 'assemblyKey'],
    ['an assemblyKey from another project', { assemblyKey: 'HAR-1' }, 'assemblyKey'],
    ['a non-string name', { name: 5 }, 'name'],
    ['an 81-character name', { name: 'n'.repeat(81) }, 'name'],
    ['revisionChainKeys that is not an array', { revisionChainKeys: 'VAL-1' }, 'revisionChainKeys'],
    ['51 revisionChainKeys', { revisionChainKeys: Array.from({ length: 51 }, (_, i) => `VAL-${i + 1}`) }, 'revisionChainKeys'],
    ['a bad revisionChainKeys entry', { revisionChainKeys: ['VAL-1', 'nope'] }, 'revisionChainKeys[1]'],
    ['a bad cloneFromBuildKey', { cloneFromBuildKey: 'VAL-' }, 'cloneFromBuildKey'],
  ])('answers 400 for %s', async (_, override, field) => {
    const buildService = { createBuild: jest.fn() };
    const res = await request(buildApp(buildService)).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: 'Intake', ...override,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(field);
    expect(buildService.createBuild).not.toHaveBeenCalled();
  });

  it('accepts a 60-character description', async () => {
    const buildService = { createBuild: jest.fn().mockResolvedValue(BUILD) };
    const res = await request(buildApp(buildService)).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: 'Intake', description: 'd'.repeat(60),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/builds/for-part/:partKey', () => {
  it('returns the builds a part is linked to', async () => {
    const buildService = {
      getBuildsForPart: jest.fn().mockResolvedValue([{ key: 'VAL-11', buildNumber: 2 }]),
    };
    const app = buildApp(buildService);

    const res = await request(app).get('/api/builds/for-part/VAL-50');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'VAL-11', buildNumber: 2 }]);
    expect(buildService.getBuildsForPart).toHaveBeenCalledWith('VAL-50');
  });
});

describe('POST /api/builds/:key/parts/:partKey/recreate', () => {
  it('re-creates the part for the target build', async () => {
    const buildService = {
      recreateForBuild: jest.fn().mockResolvedValue({ key: 'VAL-51', revision: 'B' }),
    };
    const app = buildApp(buildService);

    const res = await request(app).post('/api/builds/VAL-11/parts/VAL-50/recreate');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'VAL-51', revision: 'B' });
    expect(buildService.recreateForBuild).toHaveBeenCalledWith({
      partKey: 'VAL-50',
      targetBuildKey: 'VAL-11',
    });
  });
});

describe('GET /api/builds/:key/parts', () => {
  it('returns the linked part keys', async () => {
    const buildService = { getLinkedParts: jest.fn().mockResolvedValue(['VAL-50', 'VAL-51']) };
    const app = buildApp(buildService);

    const res = await request(app).get('/api/builds/VAL-11/parts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['VAL-50', 'VAL-51']);
    expect(buildService.getLinkedParts).toHaveBeenCalledWith('VAL-11');
  });
});

describe('POST /api/builds/:key/parts', () => {
  it('requires partKey', async () => {
    const app = buildApp({});
    const res = await request(app).post('/api/builds/VAL-11/parts').send({});
    expect(res.status).toBe(400);
  });

  it('links the part to the build', async () => {
    const buildService = { linkPartToBuild: jest.fn().mockResolvedValue(undefined) };
    const app = buildApp(buildService);

    const res = await request(app).post('/api/builds/VAL-11/parts').send({ partKey: 'VAL-50' });
    expect(res.status).toBe(200);
    expect(buildService.linkPartToBuild).toHaveBeenCalledWith('VAL-50', 'VAL-11');
  });
});

describe('POST /api/builds/:key/cut-version', () => {
  it('requires assemblyKey', async () => {
    const app = buildApp({});
    const res = await request(app).post('/api/builds/VAL-11/cut-version').send({});
    expect(res.status).toBe(400);
  });

  it('cuts the version via Onshape and reports the link plus superseded siblings', async () => {
    const buildService = {
      cutVersionFromOnshape: jest.fn().mockResolvedValue({
        onshapeVersionLink: 'https://cad.onshape.com/documents/d/v/v1/e/e1',
        superseded: ['VAL-10'],
        resumed: false,
      }),
    };
    const app = buildApp(buildService);

    const res = await request(app).post('/api/builds/VAL-11/cut-version').send({
      assemblyKey: 'VAL-1',
      documentId: 'd',
      workspaceId: 'w',
      elementId: 'e1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      onshapeVersionLink: 'https://cad.onshape.com/documents/d/v/v1/e/e1',
      superseded: ['VAL-10'],
      resumed: false,
    });
    // Body OnShape ids are ignored; the server reads them from the Assembly.
    expect(buildService.cutVersionFromOnshape).toHaveBeenCalledWith({
      buildKey: 'VAL-11',
      assemblyKey: 'VAL-1',
    });
  });
});

describe('POST /api/builds/:key/archive', () => {
  it('archives the build', async () => {
    const buildService = { archiveBuild: jest.fn().mockResolvedValue(undefined) };
    const app = buildApp(buildService);

    const res = await request(app).post('/api/builds/VAL-11/archive');
    expect(res.status).toBe(200);
    expect(buildService.archiveBuild).toHaveBeenCalledWith('VAL-11');
  });

  it('answers 400 for a key outside the project, before any write', async () => {
    const buildService = { archiveBuild: jest.fn() };
    const app = buildApp(buildService);
    const res = await request(app).post('/api/builds/OTHER-11/archive');
    expect(res.status).toBe(400);
    expect(buildService.archiveBuild).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// INC-4
// ---------------------------------------------------------------------------

const { conflict } = await import('../../src/server/middleware/httpError.js');
const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');

describe('POST /api/builds/:key/save', () => {
  const VALUES = { quantity: 4, material: 'PETG-CF', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' };
  const okService = () => ({ saveBuildParts: jest.fn().mockResolvedValue({ results: [] }) });

  it('passes creates, updates and links to the service and answers 200', async () => {
    const buildService = okService();
    const body = {
      creates: [{ ref: 'VF27P-0004A', summary: 'VF27P-0004A Spacer', revision: 'A', ...VALUES }],
      updates: [{ ref: 'VAL-31', key: 'VAL-31', ...VALUES, link: true }],
      links: [{ ref: 'VAL-33', key: 'VAL-33' }],
    };
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-51/save').send(body);
    expect(res.status).toBe(200);
    expect(buildService.saveBuildParts).toHaveBeenCalledWith({ buildKey: 'VAL-51', ...body });
  });

  it('treats a missing list as empty', async () => {
    const buildService = okService();
    await request(buildApp(buildService)).post('/api/builds/VAL-51/save').send({ links: [{ ref: 'a', key: 'VAL-33' }] });
    expect(buildService.saveBuildParts).toHaveBeenCalledWith({
      buildKey: 'VAL-51', creates: [], updates: [], links: [{ ref: 'a', key: 'VAL-33' }],
    });
  });

  it('answers 200 with per-item results when an item failed (material in creates[1])', async () => {
    const results = [
      { ref: 'VF27P-0004A', op: 'create', ok: true, key: 'VAL-60' },
      { ref: 'VF27P-0005A', op: 'create', ok: false, field: 'material', error: 'Material "Steel" isn\'t on the list. Pick one.' },
    ];
    const buildService = { saveBuildParts: jest.fn().mockResolvedValue({ results }) };
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-51/save').send({
      creates: [
        { ref: 'VF27P-0004A', summary: 'VF27P-0004A Spacer', ...VALUES },
        { ref: 'VF27P-0005A', summary: 'VF27P-0005A Spacer', ...VALUES, material: 'Steel' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results });
  });

  const tooMany = Array.from({ length: 201 }, (_, i) => ({ ref: `r${i}`, key: 'VAL-33' }));
  it.each([
    ['a bad Build key', 'val-51', { links: [{ ref: 'a', key: 'VAL-33' }] }, /key: /],
    ['an empty save', 'VAL-51', {}, /1 to 200 items/],
    ['more than 200 items', 'VAL-51', { links: tooMany }, /1 to 200 items/],
    ['a non-array list', 'VAL-51', { links: { ref: 'a' } }, /links must be an array/],
    ['a non-object item', 'VAL-51', { links: ['VAL-33'] }, /links\[0\]: must be an object/],
    ['a missing ref', 'VAL-51', { links: [{ key: 'VAL-33' }] }, /links\[0\]\.ref/],
    ['a ref over 40 characters', 'VAL-51', { links: [{ ref: 'x'.repeat(41), key: 'VAL-33' }] }, /ref/],
    ['a duplicate ref', 'VAL-51', { links: [{ ref: 'a', key: 'VAL-33' }], updates: [{ ref: 'a', key: 'VAL-34' }] }, /used twice/],
    ['a create summary without a Part number', 'VAL-51', { creates: [{ ref: 'a', summary: 'Spacer' }] },
      /creates\[0\]\.summary: summary must start with a Part number like VF27P-0001A/],
    ['an Assembly number as a create summary', 'VAL-51', { creates: [{ ref: 'a', summary: 'VF27A-0000A Asm' }] }, /creates\[0\]\.summary/],
    ['a create summary over 255 characters', 'VAL-51', { creates: [{ ref: 'a', summary: `VF27P-0004A ${'x'.repeat(250)}` }] }, /summary/],
    ['a non-string revision', 'VAL-51', { creates: [{ ref: 'a', summary: 'VF27P-0004A S', revision: 1 }] }, /revision/],
    ['an update with a bad key', 'VAL-51', { updates: [{ ref: 'a', key: 'HAR-1' }] }, /updates\[0\]\.key/],
    ['an update with a non-boolean link', 'VAL-51', { updates: [{ ref: 'a', key: 'VAL-31', link: 'yes' }] }, /updates\[0\]\.link/],
    ['a link with a bad key', 'VAL-51', { links: [{ ref: 'a', key: 'nope' }] }, /links\[0\]\.key/],
  ])('rejects %s with 400 and no service call', async (_, key, body, message) => {
    const buildService = okService();
    const res = await request(buildApp(buildService)).post(`/api/builds/${key}/save`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(buildService.saveBuildParts).not.toHaveBeenCalled();
  });

  it('ignores a summary on an update (passes it through for the service to drop)', async () => {
    const buildService = okService();
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-51/save').send({
      updates: [{ ref: 'a', key: 'VAL-31', summary: 'anything', ...VALUES }],
    });
    expect(res.status).toBe(200);
  });
});

const { BuildService } = await import('../../src/server/services/buildService.js');
const { PartService } = await import('../../src/server/services/partService.js');

describe('POST /api/builds/:key/save validation through the real services (B1)', () => {
  const VALUES = { quantity: 1, material: 'AL 6061', machinery: 'CNC Mill', powdercoat: 'None', thickness: 'None' };

  function appWithRealServices() {
    const jiraClient = {
      getIssue: jest.fn().mockImplementation(async (key) => {
        if (key === 'VAL-51') {
          return { key, fields: { issuetype: { name: 'Build' }, status: { name: 'Draft' }, customfield_10110: 'VAL-30', customfield_10501: 1 } };
        }
        throw new JiraApiError('Issue does not exist', 404, 'getIssue');
      }),
      searchIssues: jest.fn().mockResolvedValue([]),
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-60' }),
      createIssueLink: jest.fn().mockResolvedValue(undefined),
    };
    const partService = new PartService({ jiraClient });
    const revisionService = { getRevisionChain: jest.fn().mockResolvedValue(['VAL-30']) };
    const buildService = new BuildService({ jiraClient, partService, revisionService });
    return { jiraClient, app: buildApp(buildService) };
  }

  it.each([
    ['revision "AA"', { revision: 'AA' }, 'revision'],
    ['material "Steel"', { material: 'Steel' }, 'material'],
  ])('answers 200 with ok:false for %s and creates nothing', async (_, extra, field) => {
    const { jiraClient, app } = appWithRealServices();
    const res = await request(app).post('/api/builds/VAL-51/save').send({
      creates: [{ ref: 'VF27P-0001A', summary: 'VF27P-0001A Plate', revision: 'A', ...VALUES, ...extra }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([expect.objectContaining({ ref: 'VF27P-0001A', ok: false, field })]);
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });
});

describe('GET /api/builds/status', () => {
  const okService = () => ({
    getBuildStatuses: jest.fn().mockResolvedValue({ builds: [{ key: 'VAL-1', status: 'Active' }], missing: [] }),
    getLinkedParts: jest.fn(),
    getBuildsForPart: jest.fn(),
  });

  it.each([
    ['no keys', ''],
    ['an empty keys', '?keys='],
    ['11 distinct keys', `?keys=${Array.from({ length: 11 }, (_, i) => `VAL-${i + 1}`).join(',')}`],
    ['a repeated keys parameter', '?keys=VAL-1&keys=VAL-2'],
    ['a lower-case key', '?keys=val-1'],
  ])('rejects %s with 400 and no read', async (_, query) => {
    const buildService = okService();
    const res = await request(buildApp(buildService)).get(`/api/builds/status${query}`);
    expect(res.status).toBe(400);
    expect(buildService.getBuildStatuses).not.toHaveBeenCalled();
  });

  it('removes duplicates and answers the statuses', async () => {
    const buildService = okService();
    const res = await request(buildApp(buildService)).get('/api/builds/status?keys=VAL-1,%20VAL-1,');
    expect(res.status).toBe(200);
    expect(buildService.getBuildStatuses).toHaveBeenCalledWith(['VAL-1']);
    expect(res.body).toEqual({ builds: [{ key: 'VAL-1', status: 'Active' }], missing: [] });
  });

  it('is matched before the /:key routes', async () => {
    const buildService = okService();
    await request(buildApp(buildService)).get('/api/builds/status?keys=VAL-1');
    expect(buildService.getLinkedParts).not.toHaveBeenCalled();
    expect(buildService.getBuildsForPart).not.toHaveBeenCalled();
  });

  it('passes a tracker 503 through', async () => {
    const buildService = { getBuildStatuses: jest.fn().mockRejectedValue(new JiraApiError('down', 503, 'x')) };
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(buildApp(buildService)).get('/api/builds/status?keys=VAL-1');
    err.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.source).toBe('tracker');
  });
});

describe('POST /api/builds/:key/cut-version (INC-4)', () => {
  it('accepts a body with no OnShape ids', async () => {
    const buildService = { cutVersionFromOnshape: jest.fn().mockResolvedValue({ onshapeVersionLink: 'l', superseded: [], resumed: true }) };
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-11/cut-version').send({ assemblyKey: 'VAL-1' });
    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
  });

  it.each([
    ['a bad Build key', 'val-11', { assemblyKey: 'VAL-1' }],
    ['a bad assemblyKey', 'VAL-11', { assemblyKey: 'HAR-1' }],
  ])('rejects %s with 400', async (_, key, body) => {
    const buildService = { cutVersionFromOnshape: jest.fn() };
    const res = await request(buildApp(buildService)).post(`/api/builds/${key}/cut-version`).send(body);
    expect(res.status).toBe(400);
    expect(buildService.cutVersionFromOnshape).not.toHaveBeenCalled();
  });

  it('answers 409 with the HTTP status and the Build\'s buildStatus', async () => {
    const buildService = {
      cutVersionFromOnshape: jest.fn().mockRejectedValue(conflict('Build 1 has already been cut.', { buildStatus: 'Active' })),
    };
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-11/cut-version').send({ assemblyKey: 'VAL-1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Build 1 has already been cut.', status: 409, buildStatus: 'Active' });
  });

  it('a staged failure keeps cutStage and the link in the body', async () => {
    const err = Object.assign(new JiraApiError('down', 503, 'x'), { details: { cutStage: 'supersede', onshapeVersionLink: 'l' } });
    const buildService = { cutVersionFromOnshape: jest.fn().mockRejectedValue(err) };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-11/cut-version').send({ assemblyKey: 'VAL-1' });
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ cutStage: 'supersede', onshapeVersionLink: 'l', source: 'tracker' });
  });
});

describe('POST /api/builds/:key/parts/:partKey/recreate (INC-4)', () => {
  it.each([
    ['a bad Build key', '/api/builds/val-11/parts/VAL-50/recreate'],
    ['a bad Part key', '/api/builds/VAL-11/parts/HAR-50/recreate'],
  ])('rejects %s with 400', async (_, url) => {
    const buildService = { recreateForBuild: jest.fn() };
    const res = await request(buildApp(buildService)).post(url);
    expect(res.status).toBe(400);
    expect(buildService.recreateForBuild).not.toHaveBeenCalled();
  });

  it('answers 409 with recreatedAs', async () => {
    const buildService = {
      recreateForBuild: jest.fn().mockRejectedValue(conflict('VAL-50 was already re-created as VAL-51. Re-create VAL-51 instead.', { recreatedAs: 'VAL-51' })),
    };
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-11/parts/VAL-50/recreate');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: 409, recreatedAs: 'VAL-51' });
  });

  it('returns the Part object', async () => {
    const part = { key: 'VAL-51', fullPartNumber: 'VR26P-0001B', revision: 'B' };
    const buildService = { recreateForBuild: jest.fn().mockResolvedValue({ key: 'VAL-51', revision: 'B', part }) };
    const res = await request(buildApp(buildService)).post('/api/builds/VAL-11/parts/VAL-50/recreate');
    expect(res.body).toEqual({ key: 'VAL-51', revision: 'B', part });
  });
});
