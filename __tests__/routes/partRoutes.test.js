/**
 * Integration test for the new /api/parts/by-keys route — a minimal Express
 * app wired like src/server/index.js, with a mocked PartService, exercised
 * via supertest.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const { apiNotFound, errorHandler } = await import('../../src/server/middleware/errorHandler.js');
const { cors } = await import('../../src/server/middleware/cors.js');
const { default: partRoutes } = await import('../../src/server/routes/partRoutes.js');

function buildApp(partService) {
  const app = express();
  app.use(cors);
  app.use(express.json());
  app.use('/api', partRoutes({ partService, exportService: {} }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}

describe('POST /api/parts/:key/clone', () => {
  it('requires epicKey', async () => {
    const app = buildApp({});
    const res = await request(app).post('/api/parts/VAL-50/clone').send({});
    expect(res.status).toBe(400);
  });

  it('clones the part under the given epic', async () => {
    const partService = {
      clonePart: jest.fn().mockResolvedValue({ key: 'VAL-99', fullPartNumber: 'VR26P-0002A Spare' }),
    };
    const app = buildApp(partService);

    const res = await request(app).post('/api/parts/VAL-50/clone').send({
      epicKey: 'VAL-1', name: 'Spare', quantity: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'VAL-99', fullPartNumber: 'VR26P-0002A Spare' });
    expect(partService.clonePart).toHaveBeenCalledWith({
      sourceKey: 'VAL-50', epicKey: 'VAL-1', name: 'Spare', quantity: 1,
    });
  });
});

describe('GET /api/parts/by-keys', () => {
  it('requires keys', async () => {
    const app = buildApp({});
    const res = await request(app).get('/api/parts/by-keys');
    expect(res.status).toBe(400);
  });

  it('splits a comma-separated keys list and returns the parsed stories', async () => {
    const partService = {
      getStoriesByKeys: jest.fn().mockResolvedValue([{ key: 'VAL-50' }, { key: 'VAL-51' }]),
    };
    const app = buildApp(partService);

    const res = await request(app).get('/api/parts/by-keys?keys=VAL-50,%20VAL-51');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'VAL-50' }, { key: 'VAL-51' }]);
    expect(partService.getStoriesByKeys).toHaveBeenCalledWith(['VAL-50', 'VAL-51']);
  });
});
const { PartService } = await import('../../src/server/services/partService.js');
describe('PUT /api/stories/:key validation (B1)', () => {
  function appWithRealService() {
    const jiraClient = { updateIssue: jest.fn().mockResolvedValue(undefined) };
    return { jiraClient, app: buildApp(new PartService({ jiraClient })) };
  }
  const body = {
    summary: 'VF27P-0001A Plate', epic: 'HAR-2030', material: 'AL 6061', machinery: 'CNC Mill', quantity: 1,
  };
  it('answers 400 for revision "AA"', async () => {
    const { jiraClient, app } = appWithRealService();
    const res = await request(app).put('/api/stories/HAR-3000').send({ ...body, revision: 'AA' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Validation failed: /);
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  });
  it('answers 400 for material "Steel"', async () => {
    const { jiraClient, app } = appWithRealService();
    const res = await request(app).put('/api/stories/HAR-3000').send({ ...body, material: 'Steel' });
    expect(res.status).toBe(400);
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  });
  it('still updates a valid Part', async () => {
    const { jiraClient, app } = appWithRealService();
    const res = await request(app).put('/api/stories/HAR-3000').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('HAR-3000', expect.objectContaining({ summary: 'VF27P-0001A Plate' }));
  });
});

describe('removed legacy create routes (INC-9)', () => {
  it.each([
    ['POST /api/stories', (app) => request(app).post('/api/stories').send({ summary: 'VF27P-0001A Plate' })],
    ['POST /api/parts/upload', (app) => request(app).post('/api/parts/upload').send({ parts: [{ summary: 'VF27P-0001A Plate' }] })],
  ])('%s answers 404 and creates nothing', async (_, send) => {
    const partService = { createStory: jest.fn(), uploadSelected: jest.fn() };
    const res = await send(buildApp(partService));
    expect(res.status).toBe(404);
    expect(partService.createStory).not.toHaveBeenCalled();
    expect(partService.uploadSelected).not.toHaveBeenCalled();
  });
});

describe('GET /api/stories?key=', () => {
  it('still lists the Parts of an Assembly', async () => {
    const partService = { getStoriesByEpic: jest.fn().mockResolvedValue([{ key: 'HAR-3000' }]) };
    const res = await request(buildApp(partService)).get('/api/stories?key=HAR-2030');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'HAR-3000' }]);
    expect(partService.getStoriesByEpic).toHaveBeenCalledWith('HAR-2030');
  });
});

// ---------------------------------------------------------------------------
// INC-4: chain reads, preview validation, clone validation
// ---------------------------------------------------------------------------

// validateIssueKey reads the project at call time; pin it for these tests.
const savedProject = process.env.PROJECT_KEY;
beforeAll(() => { process.env.PROJECT_KEY = 'VAL'; });
afterAll(() => {
  if (savedProject === undefined) delete process.env.PROJECT_KEY;
  else process.env.PROJECT_KEY = savedProject;
});

describe('GET /api/stories?chain=1', () => {
  it('returns the chain stories', async () => {
    const partService = { getStoriesForChain: jest.fn().mockResolvedValue({ chain: ['VAL-1'], stories: [{ key: 'VAL-50' }] }) };
    const res = await request(buildApp(partService)).get('/api/stories?key=VAL-1&chain=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'VAL-50' }]);
    expect(partService.getStoriesForChain).toHaveBeenCalledWith('VAL-1');
  });

  it('answers 400 for chain=2', async () => {
    const partService = { getStoriesForChain: jest.fn() };
    const res = await request(buildApp(partService)).get('/api/stories?key=VAL-1&chain=2');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('chain must be 1');
  });

  it('answers 400 for a lower-case key', async () => {
    const partService = { getStoriesForChain: jest.fn() };
    const res = await request(buildApp(partService)).get('/api/stories?key=val-1&chain=1');
    expect(res.status).toBe(400);
    expect(partService.getStoriesForChain).not.toHaveBeenCalled();
  });

  it('answers 400 for a Part key without searching', async () => {
    const jiraClient = {
      getIssue: jest.fn().mockResolvedValue({ fields: { issuetype: { name: 'Part' } } }),
      searchIssues: jest.fn(),
    };
    const res = await request(buildApp(new PartService({ jiraClient }))).get('/api/stories?key=VAL-2031&chain=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('"VAL-2031" is not an Assembly');
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
  });

  it('answers 404 for a key that does not exist', async () => {
    const jiraClient = {
      getIssue: jest.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 404 })),
      searchIssues: jest.fn(),
    };
    const res = await request(buildApp(new PartService({ jiraClient }))).get('/api/stories?key=VAL-9&chain=1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No Assembly VAL-9 found');
  });

  it('keeps the unscoped key path unchanged', async () => {
    const partService = { getStoriesByEpic: jest.fn().mockResolvedValue([]) };
    const res = await request(buildApp(partService)).get('/api/stories?key=VAL-1');
    expect(res.status).toBe(200);
    expect(partService.getStoriesByEpic).toHaveBeenCalledWith('VAL-1');
  });
});

describe('POST /api/parts/preview validation', () => {
  const ID = 'a'.repeat(24);
  const body = { epicKey: 'VAL-1', documentId: ID, workspaceId: ID, elementId: ID };

  it('passes fresh through', async () => {
    const partService = { previewParts: jest.fn().mockResolvedValue({ newParts: [] }) };
    const res = await request(buildApp(partService)).post('/api/parts/preview').send({ ...body, fresh: true });
    expect(res.status).toBe(200);
    expect(partService.previewParts).toHaveBeenCalledWith({ ...body, fresh: true });
  });

  it.each([
    ['a non-hex elementId', { elementId: 'not-hex' }, /elementId/],
    ['fresh "yes"', { fresh: 'yes' }, /fresh/],
    ['a bad epicKey', { epicKey: 'har-1' }, /epicKey/],
  ])('answers 400 for %s', async (_, extra, message) => {
    const partService = { previewParts: jest.fn() };
    const res = await request(buildApp(partService)).post('/api/parts/preview').send({ ...body, ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(partService.previewParts).not.toHaveBeenCalled();
  });
});

describe('POST /api/parts/:key/clone validation', () => {
  it.each([
    ['a bad source key', '/api/parts/HAR-50/clone', { epicKey: 'VAL-1' }],
    ['a bad epicKey', '/api/parts/VAL-50/clone', { epicKey: 'val-1' }],
    ['an empty name', '/api/parts/VAL-50/clone', { epicKey: 'VAL-1', name: '   ' }],
    ['a name over 80 characters', '/api/parts/VAL-50/clone', { epicKey: 'VAL-1', name: 'x'.repeat(81) }],
    ['a quantity of 0', '/api/parts/VAL-50/clone', { epicKey: 'VAL-1', quantity: 0 }],
  ])('answers 400 for %s', async (_, url, body) => {
    const partService = { clonePart: jest.fn() };
    const res = await request(buildApp(partService)).post(url).send(body);
    expect(res.status).toBe(400);
    expect(partService.clonePart).not.toHaveBeenCalled();
  });

  it('returns key, fullPartNumber and part', async () => {
    const part = { key: 'VAL-99', fullPartNumber: 'VR26P-0002A' };
    const partService = { clonePart: jest.fn().mockResolvedValue({ key: 'VAL-99', fullPartNumber: 'VR26P-0002A Spare', part }) };
    const res = await request(buildApp(partService)).post('/api/parts/VAL-50/clone').send({ epicKey: 'VAL-1', name: ' Spare ' });
    expect(res.body).toEqual({ key: 'VAL-99', fullPartNumber: 'VR26P-0002A Spare', part });
    expect(partService.clonePart).toHaveBeenCalledWith({ sourceKey: 'VAL-50', epicKey: 'VAL-1', name: 'Spare', quantity: undefined });
  });
});
