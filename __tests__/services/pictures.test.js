import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { Pictures } from '../../src/server/services/pictures.js';
import pictureRoutes from '../../src/server/routes/pictureRoutes.js';
import { BuildService } from '../../src/server/services/buildService.js';
import { errorHandler } from '../../src/server/middleware/errorHandler.js';

const DOC = 'a'.repeat(24);
const WS = 'b'.repeat(24);
const EL = 'c'.repeat(24);
const VER = 'd'.repeat(24);
const LINK = `https://cad.onshape.com/documents/${DOC}/v/${VER}/e/${EL}`;
const att = (id, filename) => ({ id, filename, content: `https://jira.example/secure/attachment/${id}/${filename}` });

function make({ issues, bytes = (a) => Buffer.from(`bytes-${a.content}`) }) {
  const jiraClient = {
    getIssue: jest.fn(async (key) => {
      if (!issues[key]) throw Object.assign(new Error('missing'), { status: 404 });
      return { key, fields: issues[key] };
    }),
    getAttachmentContent: jest.fn(async (content) => bytes({ content })),
    addAttachment: jest.fn().mockResolvedValue(undefined),
  };
  const onshapeClient = { getAssemblyImage: jest.fn().mockResolvedValue(Buffer.from('ASSEMBLY-PNG')) };
  return { pictures: new Pictures({ jiraClient, onshapeClient }), jiraClient, onshapeClient };
}

const part = (attachments, summary = 'VR27P-1101A Tube') => ({ issuetype: { name: 'Part' }, summary, attachment: attachments });
const build = (over = {}) => ({
  issuetype: { name: 'Build' }, customfield_10110: 'HAR-30', customfield_10501: 2, customfield_10502: null, attachment: [], ...over,
});
const assembly = { customfield_10300: DOC, customfield_10301: WS, customfield_10302: EL, summary: 'VR27A-1100A Base Frame' };

describe('Pictures.partImage', () => {
  it("reads the Part's own PNG from its ticket and keeps it", async () => {
    const { pictures, jiraClient } = make({ issues: { 'HAR-9': part([att(1, 'VR27P-1101A.step'), att(2, 'VR27P-1101A.png')]) } });
    expect((await pictures.partImage('HAR-9')).toString()).toContain('/secure/attachment/2/VR27P-1101A.png');
    await pictures.partImage('HAR-9');
    expect(jiraClient.getAttachmentContent).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for a Part with no picture, and ignores another Part\'s PNG', async () => {
    const { pictures } = make({ issues: { 'HAR-9': part([att(2, 'VR27P-9999A.png')]), 'HAR-8': part([]) } });
    await expect(pictures.partImage('HAR-9')).rejects.toMatchObject({ status: 404 });
    await expect(pictures.partImage('HAR-8')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a ticket that is not a Part, and a ticket that does not exist', async () => {
    const { pictures } = make({ issues: { 'HAR-30': { issuetype: { name: 'Assembly' }, summary: 'x', attachment: [] } } });
    await expect(pictures.partImage('HAR-30')).rejects.toMatchObject({ status: 400 });
    await expect(pictures.partImage('HAR-1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('Pictures.buildImage', () => {
  const issues = (b) => ({ 'HAR-52': b, 'HAR-30': assembly });

  it('serves the picture attached to a cut Build', async () => {
    const { pictures, onshapeClient } = make({ issues: issues(build({ customfield_10502: LINK, attachment: [att(7, 'VR27A-1100A Build 2.png')] })) });
    const { image, live } = await pictures.buildImage('HAR-52');
    expect(image.toString()).toContain('/secure/attachment/7/');
    expect(live).toBe(false);
    expect(onshapeClient.getAssemblyImage).not.toHaveBeenCalled();
  });

  it('draws a cut Build from its version when it has no picture yet, and attaches it', async () => {
    const { pictures, onshapeClient, jiraClient } = make({ issues: issues(build({ customfield_10502: LINK })) });
    const { image, live } = await pictures.buildImage('HAR-52');
    expect(image.toString()).toBe('ASSEMBLY-PNG');
    expect(live).toBe(false);
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledWith(
      { documentId: DOC, wvmType: 'v', wvmId: VER, elementId: EL }, { width: 1000, height: 700 },
    );
    await new Promise((resolve) => { setImmediate(resolve); });
    await new Promise((resolve) => { setImmediate(resolve); });
    expect(jiraClient.addAttachment).toHaveBeenCalledWith('HAR-52', 'VR27A-1100A Build 2.png', expect.any(Buffer));
    // Asked again: no second drawing, no second attachment.
    await pictures.buildImage('HAR-52');
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledTimes(1);
    expect(jiraClient.addAttachment).toHaveBeenCalledTimes(1);
  });

  it('draws a Draft from the workspace as it is now, reusing a recent drawing until asked for a fresh one', async () => {
    const { pictures, onshapeClient } = make({ issues: issues(build()) });
    const first = await pictures.buildImage('HAR-52');
    expect(first.live).toBe(true);
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledWith(
      { documentId: DOC, wvmType: 'w', wvmId: WS, elementId: EL }, { width: 1000, height: 700 },
    );
    await pictures.buildImage('HAR-52');
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledTimes(1);
    await pictures.buildImage('HAR-52', { fresh: true });
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledTimes(2);
  });

  it('draws once for callers who ask at the same time', async () => {
    const { pictures, onshapeClient } = make({ issues: issues(build()) });
    await Promise.all([pictures.buildImage('HAR-52'), pictures.buildImage('HAR-52')]);
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledTimes(1);
  });

  it('refuses a ticket that is not a Build, and says when the Assembly has no OnShape link', async () => {
    const a = make({ issues: { 'HAR-9': part([]) } });
    await expect(a.pictures.buildImage('HAR-9')).rejects.toMatchObject({ status: 400 });
    const b = make({ issues: { 'HAR-52': build(), 'HAR-30': { ...assembly, customfield_10300: null } } });
    await expect(b.pictures.buildImage('HAR-52')).rejects.toMatchObject({ status: 404 });
  });
});

describe('Pictures.attachBuildImage', () => {
  const args = { buildKey: 'HAR-52', buildNumber: 2, assemblyKey: 'HAR-30', versionLink: LINK };

  it('draws the cut version and attaches it, named by Assembly and Build', async () => {
    const { pictures, jiraClient } = make({ issues: { 'HAR-52': build(), 'HAR-30': assembly } });
    expect(await pictures.attachBuildImage(args)).toEqual({ attached: true });
    expect(jiraClient.addAttachment).toHaveBeenCalledWith('HAR-52', 'VR27A-1100A Build 2.png', Buffer.from('ASSEMBLY-PNG'));
  });

  it('adds nothing when the Build already has a picture', async () => {
    const { pictures, jiraClient, onshapeClient } = make({ issues: { 'HAR-52': build({ attachment: [att(7, 'x.png')] }), 'HAR-30': assembly } });
    expect(await pictures.attachBuildImage(args)).toEqual({ attached: false });
    expect(onshapeClient.getAssemblyImage).not.toHaveBeenCalled();
    expect(jiraClient.addAttachment).not.toHaveBeenCalled();
  });

  it('never throws: it reports what went wrong', async () => {
    const { pictures, onshapeClient } = make({ issues: { 'HAR-52': build(), 'HAR-30': assembly } });
    onshapeClient.getAssemblyImage.mockRejectedValue(Object.assign(new Error('x'), { name: 'OnshapeApiError', status: 502 }));
    expect(await pictures.attachBuildImage(args)).toEqual({ attached: false, problem: "OnShape didn't respond (502)" });
    expect(await pictures.attachBuildImage({ ...args, versionLink: null })).toMatchObject({ attached: false, problem: expect.stringContaining('no OnShape version') });
  });
});

describe('picture routes', () => {
  const savedProject = process.env.PROJECT_KEY;
  beforeAll(() => { process.env.PROJECT_KEY = 'VAL'; });
  afterAll(() => {
    if (savedProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = savedProject;
  });
  const app = (pictures) => {
    const a = express();
    a.use('/api/pictures', pictureRoutes({ pictures }));
    a.use(errorHandler);
    return a;
  };

  it('serves a Part picture as a PNG the browser may keep', async () => {
    const pictures = { partImage: jest.fn().mockResolvedValue(Buffer.from('PNG')) };
    const res = await request(app(pictures)).get('/api/pictures/part/VAL-9');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('tells the browser not to keep a Draft\'s picture, and passes fresh through', async () => {
    const pictures = { buildImage: jest.fn().mockResolvedValue({ image: Buffer.from('PNG'), live: true }) };
    const res = await request(app(pictures)).get('/api/pictures/build/VAL-52?fresh=1');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(pictures.buildImage).toHaveBeenCalledWith('VAL-52', { fresh: true });
  });

  it('refuses a key that is not this project\'s', async () => {
    const pictures = { partImage: jest.fn() };
    expect((await request(app(pictures)).get('/api/pictures/part/har-1')).status).toBe(400);
    expect(pictures.partImage).not.toHaveBeenCalled();
  });
});

describe('Cut Version attaches the Assembly picture', () => {
  it('asks for it in the background once the version is made, without waiting', async () => {
    const state = { status: { name: 'Draft' }, customfield_10502: null };
    const issues = {
      'HAR-52': () => ({ fields: { issuetype: { name: 'Build' }, customfield_10110: 'HAR-30', customfield_10501: 2, ...state, issuelinks: [] } }),
      'HAR-30': { fields: { issuetype: { name: 'Assembly' }, customfield_10300: DOC, customfield_10301: WS, customfield_10302: EL } },
    };
    const jiraClient = {
      getIssue: jest.fn(async (key) => (typeof issues[key] === 'function' ? issues[key]() : issues[key])),
      searchIssues: jest.fn().mockResolvedValue([]),
      updateIssue: jest.fn(async (k, f) => Object.assign(state, f)),
      transitionIssue: jest.fn(async (k, id) => { if (/cut/i.test(String(id))) state.status = { name: 'Active' }; }),
    };
    const onshapeClient = { baseUrl: 'https://cad.onshape.com', createVersion: jest.fn().mockResolvedValue({ id: VER }) };
    const attachBuildImage = jest.fn(() => new Promise(() => {})); // never finishes: the cut must not wait for it
    const service = new BuildService({ jiraClient, onshapeClient, pictures: { attachBuildImage } });
    const result = await service.cutVersionFromOnshape({ buildKey: 'HAR-52', assemblyKey: 'HAR-30' });
    expect(result.onshapeVersionLink).toBe(LINK);
    expect(attachBuildImage).toHaveBeenCalledWith({
      buildKey: 'HAR-52', buildNumber: 2, assemblyKey: 'HAR-30', versionLink: LINK,
    });
  });
});
