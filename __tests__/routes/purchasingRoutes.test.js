import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import purchasingRoutes from '../../src/server/routes/purchasingRoutes.js';
import { OrderDraft } from '../../src/server/services/orderDraft.js';
import { errorHandler } from '../../src/server/middleware/errorHandler.js';

describe('/api/purchasing/draft', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'order-draft-route-'));
    const orderDraft = new OrderDraft({ file: path.join(dir, 'draft.json') });

    app = express();
    app.use(express.json());
    app.use('/api/purchasing', purchasingRoutes({
      purchasingService: {
        getDraft: () => orderDraft.read(),
        updateDraft: (rows) => orderDraft.update(rows),
      },
    }));
    app.use(errorHandler);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('gives one mentor what another saved', async () => {
    const saved = await request(app)
      .patch('/api/purchasing/draft')
      .send({ rows: [{ key: 'PARTS-1', selected: true, wishId: 0 }] });
    expect(saved.status).toBe(200);

    const read = await request(app).get('/api/purchasing/draft');
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ rows: { 'PARTS-1': { selected: true, wishId: 0 } } });
  });

  it('answers 400 to a bad save', async () => {
    const res = await request(app)
      .patch('/api/purchasing/draft')
      .send({ rows: [{ key: 'not a key', selected: true }] });

    expect(res.status).toBe(400);
  });

  it('answers 400 to a save with no body', async () => {
    expect((await request(app).patch('/api/purchasing/draft')).status).toBe(400);
  });
});
