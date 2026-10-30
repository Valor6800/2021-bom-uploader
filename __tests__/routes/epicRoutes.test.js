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
const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');

// validateIssueKey reads the project at call time; pin it for these tests.
const savedProject = process.env.PROJECT_KEY;
beforeAll(() => { process.env.PROJECT_KEY = 'VAL'; });
afterAll(() => {
  if (savedProject === undefined) delete process.env.PROJECT_KEY;
  else process.env.PROJECT_KEY = savedProject;
});

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

  it('returns 400 for a malformed key without calling the service', async () => {
    const epicService = { getEpicByKey: jest.fn() };

    const res = await request(buildApp(epicService)).get('/api/epics/not-a-key');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('is not a valid key');
    expect(epicService.getEpicByKey).not.toHaveBeenCalled();
  });

  it('returns 400 for a key from another project without calling the service', async () => {
    const epicService = { getEpicByKey: jest.fn() };

    const res = await request(buildApp(epicService)).get('/api/epics/OTHER-12');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('"OTHER-12" is not in project VAL');
    expect(epicService.getEpicByKey).not.toHaveBeenCalled();
  });

  it('returns 400 for a Part key through the real service', async () => {
    const jiraClient = {
      getIssue: jest.fn().mockResolvedValue({
        key: 'VAL-5',
        fields: { summary: 'VF27A-0001A Bracket', issuetype: { name: 'Part' } },
      }),
    };
    const epicService = new EpicService({ jiraClient, onshapeClient: {} });

    const res = await request(buildApp(epicService)).get('/api/epics/VAL-5');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('"VAL-5" is not an Assembly');
    expect(jiraClient.getIssue).toHaveBeenCalledWith('VAL-5');
  });

  it('returns 404 when the tracker has no such key', async () => {
    const jiraClient = {
      getIssue: jest.fn().mockRejectedValue(new JiraApiError('Not found', 404, '/issue/VAL-9')),
    };
    const epicService = new EpicService({ jiraClient, onshapeClient: {} });

    const res = await request(buildApp(epicService)).get('/api/epics/VAL-9');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No Assembly VAL-9 found', status: 404 });
  });
});

describe('GET /api/epics/search', () => {
  const RESULT = { query: '', total: 0, results: [], groups: [] };

  function searchService(impl = jest.fn().mockResolvedValue(RESULT)) {
    return { searchAssemblies: impl, getEpicByKey: jest.fn() };
  }

  it('is not captured by /:key', async () => {
    const epicService = searchService();

    const res = await request(buildApp(epicService)).get('/api/epics/search');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(RESULT);
    expect(epicService.getEpicByKey).not.toHaveBeenCalled();
    expect(epicService.searchAssemblies).toHaveBeenCalledTimes(1);
  });

  it('uses an empty query, limit 50 and open Assemblies by default', async () => {
    const epicService = searchService();

    await request(buildApp(epicService)).get('/api/epics/search');

    expect(epicService.searchAssemblies).toHaveBeenCalledWith('', { limit: 50, includeClosed: false });
  });

  it('passes the trimmed query, limit and includeClosed=1 to the service', async () => {
    const epicService = searchService();

    const res = await request(buildApp(epicService))
      .get('/api/epics/search')
      .query({ q: '  test assem  ', limit: '10', includeClosed: '1' });

    expect(res.status).toBe(200);
    expect(epicService.searchAssemblies).toHaveBeenCalledWith('test assem', { limit: 10, includeClosed: true });
  });

  it('treats includeClosed=0 as open Assemblies only', async () => {
    const epicService = searchService();

    await request(buildApp(epicService)).get('/api/epics/search').query({ q: 'x', includeClosed: '0' });

    expect(epicService.searchAssemblies).toHaveBeenCalledWith('x', { limit: 50, includeClosed: false });
  });

  it('strips control characters from the query', async () => {
    const epicService = searchService();

    await request(buildApp(epicService)).get('/api/epics/search?q=%00har%0A-2030%7F%09');

    expect(epicService.searchAssemblies).toHaveBeenCalledWith('har-2030', { limit: 50, includeClosed: false });
  });

  it('accepts a 100-character query', async () => {
    const epicService = searchService();
    const q = 'a'.repeat(100);

    const res = await request(buildApp(epicService)).get('/api/epics/search').query({ q });

    expect(res.status).toBe(200);
    expect(epicService.searchAssemblies).toHaveBeenCalledWith(q, { limit: 50, includeClosed: false });
  });

  it.each([
    ['includeClosed=yes', 'includeClosed=yes', 'includeClosed must be 0 or 1'],
    ['a repeated includeClosed', 'includeClosed=1&includeClosed=1', 'includeClosed must be 0 or 1'],
    ['a repeated q', 'q=a&q=b', 'q must be a single string'],
    ['a 101-character query', `q=${'a'.repeat(101)}`, 'Search is limited to 100 characters'],
    ['limit=0', 'limit=0', 'limit must be an integer from 1 to 50'],
    ['limit=51', 'limit=51', 'limit must be an integer from 1 to 50'],
    ['limit=1.5', 'limit=1.5', 'limit must be an integer from 1 to 50'],
    ['limit=abc', 'limit=abc', 'limit must be an integer from 1 to 50'],
  ])('returns 400 for %s without calling the service', async (_label, qs, message) => {
    const epicService = searchService();

    const res = await request(buildApp(epicService)).get(`/api/epics/search?${qs}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(epicService.searchAssemblies).not.toHaveBeenCalled();
  });

  it('passes a tracker 503 through with source "tracker"', async () => {
    const epicService = searchService(
      jest.fn().mockRejectedValue(new JiraApiError('Service Unavailable', 503, '/search')),
    );

    const res = await request(buildApp(epicService)).get('/api/epics/search').query({ q: 'x' });

    expect(res.status).toBe(503);
    expect(res.body.source).toBe('tracker');
    expect(res.body.status).toBe(503);
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

describe('POST /api/epics/onboard/preview', () => {
  const URL = 'https://cad.onshape.com/documents/8c64dfdcb66184646a7a3f17/w/82f00d3cbea6901ac26040bd/e/faea62821490977c33bc8d7c';

  it.each([
    ['a missing url', {}],
    ['a non-string url', { url: 42 }],
    ['a blank url', { url: '   ' }],
    ['a url over 2000 characters', { url: `https://cad.onshape.com/${'a'.repeat(2000)}` }],
  ])('answers 400 for %s without calling the service', async (_, body) => {
    const epicService = { previewOnboarding: jest.fn() };
    const res = await request(buildApp(epicService)).post('/api/epics/onboard/preview').send(body);
    expect(res.status).toBe(400);
    expect(epicService.previewOnboarding).not.toHaveBeenCalled();
  });

  it('trims the url and returns the preview', async () => {
    const epicService = { previewOnboarding: jest.fn().mockResolvedValue({ status: 'new', proposed: { summary: 'S' } }) };
    const res = await request(buildApp(epicService)).post('/api/epics/onboard/preview').send({ url: `  ${URL}  ` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'new', proposed: { summary: 'S' } });
    expect(epicService.previewOnboarding).toHaveBeenCalledWith(URL);
  });

  it('sends problems[] in the 400 body for incomplete OnShape properties', async () => {
    const epicService = new EpicService({
      jiraClient: { searchIssues: jest.fn().mockResolvedValue([]) },
      onshapeClient: {
        getElementMetadata: jest.fn().mockResolvedValue({
          elementType: 1,
          mimeType: 'onshape/assembly',
          properties: [
            { name: 'Name', propertyId: '57f3fb8efa3416c06701d60d', value: 'Test Assembly' },
            { name: 'Part number', propertyId: '57f3fb8efa3416c06701d60f', value: '12' },
            { name: 'Revision', propertyId: '57f3fb8efa3416c06701d610', value: 'A' },
          ],
        }),
      },
    });
    const res = await request(buildApp(epicService)).post('/api/epics/onboard/preview').send({ url: URL });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('missing Project');
    expect(res.body.problems).toEqual([
      { property: 'Project', issue: 'missing', hint: expect.any(String) },
      { property: 'Part number', issue: 'invalid', value: '12', hint: expect.any(String) },
    ]);
  });

  it('answers 409 with the other Assembly for a number conflict', async () => {
    const { conflict } = await import('../../src/server/middleware/httpError.js');
    const epicService = {
      previewOnboarding: jest.fn().mockRejectedValue(
        conflict('VF27A-0000A is already used by VAL-2040.', { assembly: { key: 'VAL-2040' }, proposed: { summary: 'S' } }),
      ),
    };
    const res = await request(buildApp(epicService)).post('/api/epics/onboard/preview').send({ url: URL });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      assembly: { key: 'VAL-2040' },
      proposed: { summary: 'S' },
      error: 'VF27A-0000A is already used by VAL-2040.',
      status: 409,
    });
  });
});

describe('POST /api/epics/onboard', () => {
  const URL = 'https://cad.onshape.com/documents/8c64dfdcb66184646a7a3f17/w/82f00d3cbea6901ac26040bd/e/faea62821490977c33bc8d7c';

  it.each([
    ['a missing url', { expectedSummary: 'S' }],
    ['a missing expectedSummary', { url: URL }],
    ['a non-string expectedSummary', { url: URL, expectedSummary: 5 }],
    ['an expectedSummary over 255 characters', { url: URL, expectedSummary: 's'.repeat(256) }],
  ])('answers 400 for %s without calling the service', async (_, body) => {
    const epicService = { onboardAssembly: jest.fn() };
    const res = await request(buildApp(epicService)).post('/api/epics/onboard').send(body);
    expect(res.status).toBe(400);
    expect(epicService.onboardAssembly).not.toHaveBeenCalled();
  });

  it('returns the created Assembly and Build', async () => {
    const body = { status: 'created', assembly: { key: 'VAL-2050' }, build: { key: 'VAL-2051' }, buildError: null };
    const epicService = { onboardAssembly: jest.fn().mockResolvedValue(body) };
    const res = await request(buildApp(epicService)).post('/api/epics/onboard')
      .send({ url: URL, expectedSummary: 'VF27A-0000A Test Assembly' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(epicService.onboardAssembly).toHaveBeenCalledWith({ url: URL, expectedSummary: 'VF27A-0000A Test Assembly' });
  });

  it('answers 409 with proposed on summary drift', async () => {
    const { conflict } = await import('../../src/server/middleware/httpError.js');
    const epicService = {
      onboardAssembly: jest.fn().mockRejectedValue(
        conflict('The OnShape properties changed since you checked. Review the new name.', { proposed: { summary: 'New' } }),
      ),
    };
    const res = await request(buildApp(epicService)).post('/api/epics/onboard').send({ url: URL, expectedSummary: 'Old' });
    expect(res.status).toBe(409);
    expect(res.body.proposed).toEqual({ summary: 'New' });
  });
});
