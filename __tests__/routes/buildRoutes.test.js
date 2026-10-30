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
  it('requires assemblyKey, documentId, workspaceId, and elementId', async () => {
    const app = buildApp({});
    const res = await request(app).post('/api/builds/VAL-11/cut-version').send({});
    expect(res.status).toBe(400);
  });

  it('cuts the version via Onshape and reports the link plus superseded siblings', async () => {
    const buildService = {
      cutVersionFromOnshape: jest.fn().mockResolvedValue({
        onshapeVersionLink: 'https://cad.onshape.com/documents/d/v/v1/e/e1',
        superseded: ['VAL-10'],
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
    });
    expect(buildService.cutVersionFromOnshape).toHaveBeenCalledWith({
      buildKey: 'VAL-11',
      assemblyKey: 'VAL-1',
      documentId: 'd',
      workspaceId: 'w',
      elementId: 'e1',
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
});
