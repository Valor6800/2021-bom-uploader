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

describe('Pictures.partDrawing', () => {
  it("reads the Part's drawing picture, not its iso picture", async () => {
    const { pictures } = make({ issues: { 'HAR-9': part([att(2, 'VR27P-1101A.png'), att(3, 'VR27P-1101A_drawing.png')]) } });
    expect((await pictures.partDrawing('HAR-9')).toString()).toContain('/secure/attachment/3/VR27P-1101A_drawing.png');
    expect((await pictures.partImage('HAR-9')).toString()).toContain('/secure/attachment/2/VR27P-1101A.png');
  });

  it('falls back to the first side view for a part with no drawing of its own', async () => {
    const { pictures } = make({ issues: { 'HAR-9': part([att(5, 'VR27P-1101A_drawing_RIGHT.png'), att(4, 'VR27P-1101A_drawing_TOP.png')]) } });
    expect((await pictures.partDrawing('HAR-9')).toString()).toContain('/secure/attachment/4/VR27P-1101A_drawing_TOP.png');
  });

  it('answers 404 for a Part with no drawing, and 400 for a ticket that is not a Part', async () => {
    const { pictures } = make({ issues: {
      'HAR-9': part([att(2, 'VR27P-1101A.png')]),
      'HAR-30': { issuetype: { name: 'Assembly' }, summary: 'x', attachment: [] },
    } });
    await expect(pictures.partDrawing('HAR-9')).rejects.toMatchObject({ status: 404 });
    await expect(pictures.partDrawing('HAR-30')).rejects.toMatchObject({ status: 400 });
  });
});

describe('Pictures.cadPicture', () => {
  const origin = { documentId: 'a'.repeat(24), wvmType: 'w', wvmId: 'b'.repeat(24), elementId: 'c'.repeat(24), partId: 'JHD', configuration: null };

  it('draws a part from its shape, and keeps it for a Part Studio version', async () => {
    const partFiles = { pictureOf: jest.fn().mockResolvedValue(Buffer.from('PNG')) };
    const pictures = new Pictures({ jiraClient: {}, onshapeClient: {}, partFiles });
    const at = { ...origin, microversionId: 'd'.repeat(24) };
    await pictures.cadPicture(at, [1, 2, 3]);
    await pictures.cadPicture(at, [1, 2, 3]);
    expect(partFiles.pictureOf).toHaveBeenCalledTimes(1);
    expect(partFiles.pictureOf).toHaveBeenCalledWith(at, [1, 2, 3]);
    // No version named: drawn again each time (the shape read itself is kept a minute).
    await pictures.cadPicture(origin);
    await pictures.cadPicture(origin);
    expect(partFiles.pictureOf).toHaveBeenCalledTimes(3);
  });

  it('answers 404 for a part OnShape doesn\'t list', async () => {
    const pictures = new Pictures({ jiraClient: {}, onshapeClient: {}, partFiles: { pictureOf: jest.fn().mockResolvedValue(null) } });
    await expect(pictures.cadPicture(origin)).rejects.toMatchObject({ status: 404 });
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

  it('serves a Part drawing as a PNG, and refuses a bad key', async () => {
    const pictures = { partDrawing: jest.fn().mockResolvedValue(Buffer.from('PNG')) };
    const res = await request(app(pictures)).get('/api/pictures/drawing/VAL-9');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(pictures.partDrawing).toHaveBeenCalledWith('VAL-9');
    expect((await request(app(pictures)).get('/api/pictures/drawing/har-1')).status).toBe(400);
  });

  it('serves a live part picture, kept for a day when the link names the Part Studio version', async () => {
    const pictures = { cadPicture: jest.fn().mockResolvedValue(Buffer.from('PNG')) };
    const q = `d=${'a'.repeat(24)}&wvm=w&wvmid=${'b'.repeat(24)}&e=${'c'.repeat(24)}&p=JHD`;
    const res = await request(app(pictures)).get(`/api/pictures/cad?${q}&mv=${'d'.repeat(24)}&rgb=ff8000&c=List_a%3DX`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(pictures.cadPicture).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'a'.repeat(24), partId: 'JHD', configuration: 'List_a=X', microversionId: 'd'.repeat(24),
    }), [255, 128, 0]);
    const now = await request(app(pictures)).get(`/api/pictures/cad?${q}`);
    expect(now.headers['cache-control']).toBe('private, max-age=60');
  });

  it('refuses anything that isn\'t an OnShape part', async () => {
    const pictures = { cadPicture: jest.fn() };
    const good = `d=${'a'.repeat(24)}&wvm=w&wvmid=${'b'.repeat(24)}&e=${'c'.repeat(24)}&p=JHD`;
    for (const q of [
      good.replace('wvm=w', 'wvm=x'),
      good.replace(`d=${'a'.repeat(24)}`, 'd=../../etc'),
      `${good}&c=${encodeURIComponent('a&b')}`,
      `${good}&rgb=red`,
      `${good}&mv=nope`,
      good.replace('p=JHD', `p=${'x'.repeat(40)}`),
    ]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app(pictures)).get(`/api/pictures/cad?${q}`)).status).toBe(400);
    }
    expect(pictures.cadPicture).not.toHaveBeenCalled();
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
