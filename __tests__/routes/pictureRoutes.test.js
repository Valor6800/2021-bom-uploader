import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import pictureRoutes from '../../src/server/routes/pictureRoutes.js';
import { errorHandler } from '../../src/server/middleware/errorHandler.js';

const savedProject = process.env.PROJECT_KEY;
beforeAll(() => { process.env.PROJECT_KEY = 'VAL'; });
afterAll(() => {
  if (savedProject === undefined) delete process.env.PROJECT_KEY;
  else process.env.PROJECT_KEY = savedProject;
});

const app = (deps) => {
  const a = express();
  a.use('/api/pictures', pictureRoutes(deps));
  a.use(errorHandler);
  return a;
};

describe('GET /api/pictures/status', () => {
  it('reports where the file jobs for the Parts stand', async () => {
    const fileJobs = { status: jest.fn().mockReturnValue({ 'VAL-9': { state: 'done', problems: [] } }) };
    const res = await request(app({ pictures: {}, fileJobs })).get('/api/pictures/status?keys=VAL-9,VAL-10');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ statuses: { 'VAL-9': { state: 'done', problems: [] } } });
    expect(fileJobs.status).toHaveBeenCalledWith(['VAL-9', 'VAL-10']);
  });

  it('answers an empty list with no keys or no queue, and refuses keys that are not this project\'s', async () => {
    const fileJobs = { status: jest.fn().mockReturnValue({}) };
    expect((await request(app({ pictures: {}, fileJobs })).get('/api/pictures/status')).body).toEqual({ statuses: {} });
    expect((await request(app({ pictures: {} })).get('/api/pictures/status?keys=VAL-9')).body).toEqual({ statuses: {} });
    expect((await request(app({ pictures: {}, fileJobs })).get('/api/pictures/status?keys=nope')).status).toBe(400);
  });
});

describe('GET /api/pictures/hardware', () => {
  const ok = 'kind=button&finish=black&d=0.19&length=0.75&head=0.361&headHeight=0.101&od=0&id=0.19';

  it('draws the hardware the query describes, as a PNG it may keep', async () => {
    const res = await request(app({ pictures: {} })).get(`/api/pictures/hardware?${ok}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toMatch(/immutable/);
    expect(res.body.subarray(1, 4).toString()).toBe('PNG');
  });

  it.each([
    ['an unknown kind', ok.replace('button', 'rocket')],
    ['an unknown finish', ok.replace('black', 'gold')],
    ['a missing size', ok.replace('&length=0.75', '')],
    ['a size that is not a number', ok.replace('0.75', '1e9')],
    ['a size too large to draw', ok.replace('length=0.75', 'length=500')],
    ['a repeated value', `${ok}&d=0.2`],
    ['nothing to draw', 'kind=nut&finish=steel&d=0&length=0&head=0&headHeight=0&od=0&id=0'],
  ])('refuses %s', async (_, query) => {
    expect((await request(app({ pictures: {} })).get(`/api/pictures/hardware?${query}`)).status).toBe(400);
  });
});
