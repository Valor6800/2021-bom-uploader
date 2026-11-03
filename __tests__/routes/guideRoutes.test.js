import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import guideRoutes from '../../src/server/routes/guideRoutes.js';
import { errorHandler } from '../../src/server/middleware/errorHandler.js';

const savedProject = process.env.PROJECT_KEY;
beforeAll(() => { process.env.PROJECT_KEY = 'VAL'; });
afterAll(() => {
  if (savedProject === undefined) delete process.env.PROJECT_KEY;
  else process.env.PROJECT_KEY = savedProject;
});

const app = (deps) => {
  const a = express();
  a.use('/api', guideRoutes({ guides: {}, vendorCatalog: {}, boardColumns: {}, ...deps }));
  a.use(errorHandler);
  return a;
};

describe('guide routes', () => {
  it('answers the guide for a Build key and refuses other keys', async () => {
    const guides = { guide: jest.fn().mockResolvedValue({ source: 'version', steps: [], kit: [] }) };
    const ok = await request(app({ guides })).get('/api/guide/VAL-5');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ source: 'version', steps: [], kit: [] });
    expect((await request(app({ guides })).get('/api/guide/nope')).status).toBe(400);
  });

  it('serves a guide picture, kept longer for a cut Build', async () => {
    const guides = { image: jest.fn().mockResolvedValue({ image: Buffer.from('png'), live: false }) };
    const res = await request(app({ guides })).get('/api/guide/VAL-5/image/2.4.3');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(guides.image).toHaveBeenCalledWith('VAL-5', '2.4.3', { large: false });
    await request(app({ guides })).get('/api/guide/VAL-5/image/root?size=large');
    expect(guides.image).toHaveBeenLastCalledWith('VAL-5', 'root', { large: true });
  });

  it('looks up plain SKUs only, at most 60', async () => {
    const vendorCatalog = { lookup: jest.fn().mockResolvedValue({ results: {} }) };
    expect((await request(app({ vendorCatalog })).get('/api/vendor/lookup?skus=wcp-1706,WCP-1492')).status).toBe(200);
    expect(vendorCatalog.lookup).toHaveBeenCalledWith([{ sku: 'WCP-1706' }, { sku: 'WCP-1492' }]);
    expect((await request(app({ vendorCatalog })).get('/api/vendor/lookup?skus=a%22b')).status).toBe(400);
    const many = Array.from({ length: 61 }, (_, i) => `WCP-${1000 + i}`).join(',');
    expect((await request(app({ vendorCatalog })).get(`/api/vendor/lookup?skus=${many}`)).status).toBe(400);
  });

  it('serves a vendor picture with its own type, or 404', async () => {
    const vendorCatalog = {
      image: jest.fn()
        .mockResolvedValueOnce({ image: Buffer.from('jpg'), contentType: 'image/jpeg' })
        .mockResolvedValueOnce(null),
    };
    const hit = await request(app({ vendorCatalog })).get('/api/vendor/image/WCP-1706');
    expect(hit.status).toBe(200);
    expect(hit.headers['content-type']).toBe('image/jpeg');
    expect(hit.headers['x-content-type-options']).toBe('nosniff');
    expect((await request(app({ vendorCatalog })).get('/api/vendor/image/WCP-1707')).status).toBe(404);
  });

  it('answers the board columns', async () => {
    const boardColumns = { get: jest.fn().mockResolvedValue({ columns: { 1: { board: 'B', column: 'C' } } }) };
    const res = await request(app({ boardColumns })).get('/api/boards/columns');
    expect(res.body).toEqual({ columns: { 1: { board: 'B', column: 'C' } } });
  });
});
