/**
 * Integration test for the new GET /api/epics/:key route — a minimal Express
 * app wired like src/server/index.js, with a mocked EpicService, exercised
 * via supertest.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const { apiNotFound, errorHandler } = await import('../../src/server/middleware/errorHandler.js');
const { cors } = await import('../../src/server/middleware/cors.js');
const { default: epicRoutes } = await import('../../src/server/routes/epicRoutes.js');
const { EpicService } = await import('../../src/server/services/epicService.js');

function buildApp(epicService) {
  const app = express();
  app.use(cors);
  app.use(express.json());
  app.use('/api/epics', epicRoutes({ epicService }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}

describe('GET /api/epics/:key', () => {
  it('returns the epic when found', async () => {
    const epicService = {
      getEpicByKey: jest.fn().mockResolvedValue({ key: 'VAL-1', summary: 'End Effector' }),
    };
    const app = buildApp(epicService);

    const res = await request(app).get('/api/epics/VAL-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'VAL-1', summary: 'End Effector' });
    expect(epicService.getEpicByKey).toHaveBeenCalledWith('VAL-1');
  });

  it('returns 400 when the key is not an Assembly', async () => {
    const epicService = { getEpicByKey: jest.fn().mockResolvedValue(null) };
    const app = buildApp(epicService);

    const res = await request(app).get('/api/epics/VAL-99');

    expect(res.status).toBe(400);
  });
});

describe('POST /api/epics/from-url', () => {
  const URL = 'https://cad.onshape.com/documents/aaa/w/bbb/e/ccc';

  it('returns the created key and summary', async () => {
    const epicService = {
      generateEpicFromURL: jest.fn().mockResolvedValue({ key: 'HAR-1', summary: 'VF27A-0000A Test Assembly' }),
    };

    const res = await request(buildApp(epicService)).post('/api/epics/from-url').send({ url: URL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'HAR-1', summary: 'VF27A-0000A Test Assembly' });
  });

  it('returns 400 with the list of missing OnShape properties', async () => {
    const epicService = new EpicService({
      jiraClient: { createIssue: jest.fn() },
      onshapeClient: {
        getElementMetadata: jest.fn().mockResolvedValue({
          elementType: 1,
          mimeType: 'onshape/assembly',
          properties: [
            { name: 'Name', propertyId: '57f3fb8efa3416c06701d60d', value: 'Test Assembly' },
            { name: 'Part number', propertyId: '57f3fb8efa3416c06701d60f', value: '0000' },
          ],
        }),
      },
    });

    const res = await request(buildApp(epicService)).post('/api/epics/from-url').send({ url: URL });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('missing Project, Revision');
  });
});
