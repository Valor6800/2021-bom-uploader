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
