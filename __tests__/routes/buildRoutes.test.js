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
  it('requires assemblyKey and name', async () => {
    const app = buildApp({});
    const res = await request(app).post('/api/builds').send({ assemblyKey: 'VAL-1' });
    expect(res.status).toBe(400);
  });

  it('creates a build without cloning when cloneFromBuildKey is omitted', async () => {
    const buildService = {
      createBuild: jest.fn().mockResolvedValue({ key: 'VAL-11', buildNumber: 2 }),
      cloneBuildParts: jest.fn(),
    };
    const app = buildApp(buildService);

    const res = await request(app).post('/api/builds').send({ assemblyKey: 'VAL-1', name: 'Intake' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'VAL-11', buildNumber: 2 });
    expect(buildService.cloneBuildParts).not.toHaveBeenCalled();
  });

  it('clones parts from the given sibling when cloneFromBuildKey is set', async () => {
    const buildService = {
      createBuild: jest.fn().mockResolvedValue({ key: 'VAL-11', buildNumber: 2 }),
      cloneBuildParts: jest.fn().mockResolvedValue({ linked: ['VAL-50'] }),
    };
    const app = buildApp(buildService);

    await request(app).post('/api/builds').send({
      assemblyKey: 'VAL-1', name: 'Intake', cloneFromBuildKey: 'VAL-10',
    });

    expect(buildService.cloneBuildParts).toHaveBeenCalledWith('VAL-10', 'VAL-11');
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
