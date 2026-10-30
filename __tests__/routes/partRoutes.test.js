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
describe('POST /api/stories validation (B1)', () => {
  function appWithRealService() {
    const jiraClient = { createIssue: jest.fn().mockResolvedValue({ key: 'HAR-3000' }) };
    return { jiraClient, app: buildApp(new PartService({ jiraClient })) };
  }
  const body = {
    summary: 'VF27P-0001A Plate', epic: 'HAR-2030', material: 'AL 6061', machinery: 'CNC Mill', quantity: 1,
  };
  it('answers 400 for revision "AA"', async () => {
    const { jiraClient, app } = appWithRealService();
    const res = await request(app).post('/api/stories').send({ ...body, revision: 'AA' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Validation failed: /);
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });
  it('answers 400 for material "Steel"', async () => {
    const { jiraClient, app } = appWithRealService();
    const res = await request(app).post('/api/stories').send({ ...body, material: 'Steel' });
    expect(res.status).toBe(400);
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });
});
