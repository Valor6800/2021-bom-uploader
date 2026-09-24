/**
 * Integration tests for the shared middleware layer and refactored routes.
 * Builds a minimal Express app wired like src/server/index.js but with mocked
 * services, and exercises it via supertest.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const { asyncHandler } = await import('../../src/server/middleware/asyncHandler.js');
const { badRequest, HttpError } = await import('../../src/server/middleware/httpError.js');
const { apiNotFound, errorHandler } = await import('../../src/server/middleware/errorHandler.js');
const { cors } = await import('../../src/server/middleware/cors.js');
const { default: partRoutes } = await import('../../src/server/routes/partRoutes.js');

function buildApp({ partService, exportService }) {
  const app = express();
  app.use(cors);
  app.use(express.json());
  app.use('/api', partRoutes({ partService, exportService }));
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}

describe('shared middleware + part routes', () => {
  it('returns the epic stories on a valid GET /api/stories?key=', async () => {
    const partService = {
      getStoriesByEpic: jest.fn().mockResolvedValue([{ key: 'VAL-1' }]),
    };
    const app = buildApp({ partService, exportService: {} });

    const res = await request(app).get('/api/stories?key=VAL-100');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'VAL-1' }]);
    expect(partService.getStoriesByEpic).toHaveBeenCalled();
  });

  it('maps a badRequest (HttpError 400) to a 400 JSON response', async () => {
    const app = buildApp({ partService: {}, exportService: {} });

    const res = await request(app).get('/api/stories');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Missing required query parameter: key or partNumber',
      status: 400,
    });
  });

  it('forwards a service error status through the error handler', async () => {
    const partService = {
      getStoriesByEpic: jest.fn().mockRejectedValue(
        Object.assign(new Error('Jira down'), { status: 502 }),
      ),
    };
    const app = buildApp({ partService, exportService: {} });

    const res = await request(app).get('/api/stories?key=VAL-1');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Jira down', status: 502 });
  });

  it('defaults an errorless throw to 500', async () => {
    const partService = {
      getStoriesByEpic: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const app = buildApp({ partService, exportService: {} });

    const res = await request(app).get('/api/stories?key=VAL-1');
    expect(res.status).toBe(500);
    expect(res.body.status).toBe(500);
  });

  it('wires getStory to GET /api/stories/:key', async () => {
    const partService = {
      getStory: jest.fn().mockResolvedValue({ key: 'VAL-9', fields: {} }),
    };
    const app = buildApp({ partService, exportService: {} });

    const res = await request(app).get('/api/stories/VAL-9');
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('VAL-9');
    expect(partService.getStory).toHaveBeenCalledWith('VAL-9');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const app = buildApp({ partService: {}, exportService: {} });

    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe(404);
  });

  it('sets CORS headers and short-circuits OPTIONS preflight', async () => {
    const app = buildApp({ partService: {}, exportService: {} });

    const res = await request(app).options('/api/stories');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('auto-export returns JSON when part is not a 3D print', async () => {
    const exportService = {
      autoExportForPrint: jest.fn().mockResolvedValue({ exported: false }),
    };
    const app = buildApp({ partService: {}, exportService });

    const res = await request(app)
      .post('/api/parts/auto-export')
      .send({ part: { machinery: 'CNC Mill' } });
    expect(res.status).toBe(200);
    expect(res.body.exported).toBe(false);
  });

  it('auto-export streams a STEP buffer when produced', async () => {
    const exportService = {
      autoExportForPrint: jest.fn().mockResolvedValue({
        exported: true,
        buffer: Buffer.from('STEPDATA'),
      }),
    };
    const app = buildApp({ partService: {}, exportService });

    const res = await request(app)
      .post('/api/parts/auto-export')
      .send({ part: { fullPartNumber: 'VR26A-0001A', machinery: '3D Printer' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/step');
    expect(res.headers['content-disposition']).toContain('VR26A-0001A.step');
  });
});

describe('httpError', () => {
  it('badRequest builds an HttpError with status 400', () => {
    const err = badRequest('nope');
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('nope');
  });
});
