/**
 * Integration test for revisionRoutes — a minimal Express app wired like
 * src/server/index.js, with a mocked RevisionService, exercised via
 * supertest.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const { apiNotFound, errorHandler } = await import('../../src/server/middleware/errorHandler.js');
const { cors } = await import('../../src/server/middleware/cors.js');
const { default: revisionRoutes } = await import('../../src/server/routes/revisionRoutes.js');

function buildApp(revisionService) {
  const app = express();
  app.use(cors);
  app.use(express.json());
  app.use('/api/revisions', revisionRoutes({ revisionService }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}

describe('GET /api/revisions/chain/:key', () => {
  it('returns the revision chain newest first', async () => {
    const revisionService = {
      getRevisionChain: jest.fn().mockResolvedValue(['VAL-5', 'VAL-1']),
    };
    const app = buildApp(revisionService);

    const res = await request(app).get('/api/revisions/chain/VAL-5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(['VAL-5', 'VAL-1']);
    expect(revisionService.getRevisionChain).toHaveBeenCalledWith('VAL-5');
  });
});
