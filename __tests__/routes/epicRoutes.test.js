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
