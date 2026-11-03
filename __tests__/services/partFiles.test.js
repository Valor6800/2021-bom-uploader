import { jest } from '@jest/globals';
import { PartFiles } from '../../src/server/services/partFiles.js';
import { PartService } from '../../src/server/services/partService.js';
import { BuildService } from '../../src/server/services/buildService.js';
import { BOMService } from '../../src/server/services/bomService.js';
import { PartNumbers } from '../../src/server/services/partNumbers.js';

// A 100 x 50 x 3.175 mm plate with one hole, in OnShape's body-details shape (metres).
const w = 0.1;
const h = 0.05;
const t = 0.003175;
const ln = (id, a, b) => ({ id, geometry: { startPoint: a, endPoint: b, midPoint: a.map((v, i) => (v + b[i]) / 2), length: Math.hypot(...a.map((v, i) => b[i] - v)) }, curve: { type: 'line' } });
const top = [ln('b', [0, 0, t], [w, 0, t]), ln('r', [w, 0, t], [w, h, t]), ln('t', [w, h, t], [0, h, t]), ln('l', [0, h, t], [0, 0, t])];
const hole = { id: 'hole', geometry: { startPoint: [0.055, 0.025, t], endPoint: [0.055, 0.025, t], midPoint: [0.045, 0.025, t], startVector: [0, 1, 0], arcSweep: 2 * Math.PI }, curve: { type: 'circle', origin: [0.05, 0.025, t], normal: [0, 0, 1], radius: 0.005 } };
const PLATE = {
  id: 'JVD',
  vertices: [[0, 0], [w, 0], [w, h], [0, h]].flatMap(([x, y], i) => [{ id: `t${i}`, point: [x, y, t] }, { id: `b${i}`, point: [x, y, 0] }]),
  edges: [...top, hole],
  faces: [
    { id: 'top', area: w * h, surface: { type: 'plane', origin: [0, 0, t], normal: [0, 0, 1] }, loops: [{ type: 'outer', coedges: top.map((e) => ({ edgeId: e.id })) }, { type: 'inner', coedges: [{ edgeId: 'hole' }] }] },
    { id: 'bottom', area: w * h - 1e-6, surface: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, -1] }, loops: [{ type: 'outer', coedges: top.map((e) => ({ edgeId: e.id })) }] },
    { id: 'side', area: w * t, surface: { type: 'plane', origin: [0, 0, 0], normal: [0, -1, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'b' }] }] },
    { id: 'end', area: h * t, surface: { type: 'plane', origin: [w, 0, 0], normal: [1, 0, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'r' }] }] },
  ],
};
const ROUND = { id: 'JRD', faces: [{ id: 'c', area: 1, surface: { type: 'cylinder' }, loops: [] }], edges: [], vertices: [] };

const origin = { documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', partId: 'JVD', configuration: null };

function make({ attachments = [], bodies = [PLATE, ROUND], exportStep } = {}) {
  const onshapeClient = {
    getBodyDetails: jest.fn().mockResolvedValue(bodies),
    getPartImage: jest.fn().mockResolvedValue(Buffer.from('PNG')),
    getTessellatedEdges: jest.fn().mockResolvedValue(new Map()),
    exportPartStep: exportStep ?? jest.fn().mockResolvedValue(Buffer.from('ISO-10303-21;')),
  };
  const jiraClient = {
    getIssue: jest.fn().mockResolvedValue({ fields: { attachment: attachments.map((filename) => ({ filename })) } }),
    addAttachment: jest.fn().mockResolvedValue(undefined),
  };
  return { files: new PartFiles({ onshapeClient, jiraClient }), onshapeClient, jiraClient };
}

describe('PartFiles.thicknessOf', () => {
  it('reads a 1/8 inch plate as 0.125', async () => {
    expect(await make().files.thicknessOf(origin)).toBe('0.125');
  });
  it('has none for a part with no flat face, and never throws', async () => {
    expect(await make().files.thicknessOf({ ...origin, partId: 'JRD' })).toBeNull();
    const { files, onshapeClient } = make();
    onshapeClient.getBodyDetails.mockRejectedValue(new Error('down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await files.thicknessOf(origin)).toBeNull();
    warn.mockRestore();
  });
  it('reads a Part Studio once for all its parts', async () => {
    const { files, onshapeClient } = make();
    await files.thicknessOf(origin);
    await files.thicknessOf({ ...origin, partId: 'JRD' });
    expect(onshapeClient.getBodyDetails).toHaveBeenCalledTimes(1);
  });
});

describe('PartFiles.attach', () => {
  it('attaches the picture, the STEP and one DXF of the largest side when the Part has a Thickness', async () => {
    const { files, jiraClient, onshapeClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result).toEqual({ attached: ['VR27P-1103A.png', 'VR27P-1103A.step', 'VR27P-1103A.dxf'], problems: [] });
    expect(onshapeClient.getPartImage).toHaveBeenCalledWith(origin);
    expect(onshapeClient.exportPartStep).toHaveBeenCalledWith(origin);
    const [[, pngName, pngBody], [, stepName, stepBody], [, dxfName, dxfBody]] = jiraClient.addAttachment.mock.calls;
    expect([pngName, stepName, dxfName]).toEqual(['VR27P-1103A.png', 'VR27P-1103A.step', 'VR27P-1103A.dxf']);
    expect(Buffer.from(pngBody).toString()).toBe('PNG');
    expect(Buffer.from(stepBody).toString()).toBe('ISO-10303-21;');
    expect(dxfBody).toEqual(expect.stringContaining('SECTION'));
    expect(dxfBody).toEqual(expect.stringContaining('CIRCLE'));
  });

  it('attaches the TOP, RIGHT and FRONT sides as DXFs when the Thickness is None', async () => {
    const { files, jiraClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: 'None' });
    expect(result.attached).toEqual([
      'VR27P-1103A.png', 'VR27P-1103A.step', 'VR27P-1103A_TOP.dxf', 'VR27P-1103A_RIGHT.dxf', 'VR27P-1103A_FRONT.dxf',
    ]);
    expect(result.problems).toEqual([]);
    const dxfs = jiraClient.addAttachment.mock.calls.filter(([, name]) => name.endsWith('.dxf'));
    expect(dxfs).toHaveLength(3);
    for (const [, , body] of dxfs) expect(body).toEqual(expect.stringContaining('ENTITIES'));
  });

  it('treats a missing Thickness like None', async () => {
    const { files } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin });
    expect(result.attached.filter((n) => n.endsWith('.dxf'))).toHaveLength(3);
  });

  it('adds only what the ticket is missing', async () => {
    const { files, jiraClient } = make({ attachments: ['VR27P-1103A.step', 'VR27P-1103A.png'] });
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result.attached).toEqual(['VR27P-1103A.dxf']);
    expect(jiraClient.addAttachment).toHaveBeenCalledTimes(1);
  });

  it('attaches a picture and a STEP but no DXF for a part with no flat side', async () => {
    const { files, jiraClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1104A', origin: { ...origin, partId: 'JRD' }, thickness: 'None' });
    expect(result).toEqual({ attached: ['VR27P-1104A.png', 'VR27P-1104A.step'], problems: [] });
    expect(jiraClient.addAttachment).toHaveBeenCalledTimes(2);
  });

  it('still attaches the others when the picture fails, and says which failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { files, onshapeClient } = make();
    onshapeClient.getPartImage.mockRejectedValue(Object.assign(new Error('boom'), { name: 'OnshapeApiError', status: 502 }));
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result.attached).toEqual(['VR27P-1103A.step', 'VR27P-1103A.dxf']);
    expect(result.problems).toEqual(["VR27P-1103A.png: OnShape didn't respond (502)"]);
    warn.mockRestore();
  });

  it('still attaches the DXF when the STEP fails, and says which failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = Object.assign(new Error('boom'), { name: 'OnshapeApiError', status: 502 });
    const { files } = make({ exportStep: jest.fn().mockRejectedValue(failure) });
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result.attached).toEqual(['VR27P-1103A.png', 'VR27P-1103A.dxf']);
    expect(result.problems).toEqual(["VR27P-1103A.step: OnShape didn't respond (502)"]);
    warn.mockRestore();
  });

  it('never throws, even when the ticket cannot be read', async () => {
    const { files, jiraClient } = make();
    jiraClient.getIssue.mockRejectedValue(Object.assign(new Error('x'), { name: 'JiraApiError', status: 503 }));
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin });
    expect(result.attached).toEqual([]);
    expect(result.problems[0]).toContain("couldn't read HAR-9");
  });
});

describe('PartService.previewParts fills in Thickness from the part', () => {
  const part = (name, extra = {}) => ({
    fullPartNumber: `VR27P-1101A`, partNumber: '1101', seasonType: 'R', year: '27', version: 'A', name, quantity: 1,
    material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'None', thickness: 'None', missing: [], origin, ...extra,
  });
  function previewWith(parts, partFiles) {
    const jiraClient = {
      getIssue: jest.fn(async (key, { fields }) => (fields.includes('issuetype')
        ? { fields: { issuetype: { name: 'Epic' } } } : { fields: { summary: 'VR27A-1100A Base Frame' } })),
      searchIssues: jest.fn().mockResolvedValue([]),
    };
    const bomService = new BOMService({ onshapeClient: {} });
    jest.spyOn(bomService, 'getBOMReport').mockResolvedValue({ parts, unidentified: [], subAssemblies: [] });
    const service = new PartService({
      jiraClient, bomService, partFiles, partNumbers: new PartNumbers({ jiraClient }),
      revisionService: { getRevisionChain: async () => ['HAR-1'] },
    });
    return service.previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });
  }

  it('sets Thickness on a new Part when its smallest dimension is a stock thickness', async () => {
    const partFiles = { thicknessOf: jest.fn().mockResolvedValue('0.125') };
    const { newParts } = await previewWith([part('Plate')], partFiles);
    expect(newParts[0].thickness).toBe('0.125');
    expect(partFiles.thicknessOf).toHaveBeenCalledWith(origin);
  });

  it('leaves it None when nothing matches, and for a 3D print or a new Revision', async () => {
    const partFiles = { thicknessOf: jest.fn().mockResolvedValue(null) };
    expect((await previewWith([part('Tube')], partFiles)).newParts[0].thickness).toBe('None');

    const asked = { thicknessOf: jest.fn().mockResolvedValue('0.125') };
    const { newParts } = await previewWith([
      part('Print', { machinery: '3D Printer', fullPartNumber: 'VR27P-1102A', partNumber: '1102' }),
    ], asked);
    expect(newParts[0].thickness).toBe('None');
    expect(asked.thicknessOf).not.toHaveBeenCalled();
  });
});

describe('BuildService.saveBuildParts queues the files of the Parts it makes, and does not wait for them', () => {
  const VALUES = { quantity: 2, material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'None', thickness: 'None' };
  const BUILD = { fields: { issuetype: { name: 'Build' }, status: { name: 'Draft' }, customfield_10110: 'HAR-30', customfield_10501: 1 } };
  const item = (number, extra = {}) => ({ ref: `VR27P-${number}A`, summary: `VR27P-${number}A Plate`, revision: 'A', ...VALUES, ...extra });

  function setup({ withJobs = true } = {}) {
    const jiraClient = {
      getIssue: jest.fn(async () => BUILD),
      searchIssues: jest.fn().mockResolvedValue([]),
      createIssueLink: jest.fn().mockResolvedValue(undefined),
    };
    let next = 3000;
    const partService = {
      getStoriesByEpics: jest.fn().mockResolvedValue([]),
      getStoriesByKeys: jest.fn().mockResolvedValue([]),
      createStory: jest.fn(async () => ({ key: `HAR-${next++}` })),
    };
    // A queue whose jobs never finish: if Save waited for them it would hang.
    const fileJobs = { enqueue: jest.fn(() => true) };
    const service = new BuildService({
      jiraClient, partService, fileJobs: withJobs ? fileJobs : undefined, revisionService: { getRevisionChain: async () => ['HAR-30'] },
    });
    return { service, fileJobs, partService };
  }

  it('queues a job for each Part made, marks it pending, and answers at once', async () => {
    const { service, fileJobs } = setup();
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item('1101'), item('1102')] });
    expect(fileJobs.enqueue).toHaveBeenCalledTimes(2);
    expect(fileJobs.enqueue).toHaveBeenCalledWith({
      key: 'HAR-3000', partNumber: 'VR27P-1101A', thickness: 'None', origin: null, assemblyKey: 'HAR-30',
    });
    expect(results.map((r) => [r.key, r.ok, r.filesPending])).toEqual([['HAR-3000', true, true], ['HAR-3001', true, true]]);
  });

  it('passes the Thickness the Part was saved with, so a plate gets one DXF', async () => {
    const { service, fileJobs } = setup();
    await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item('1101', { thickness: '0.125' })] });
    expect(fileJobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ partNumber: 'VR27P-1101A', thickness: '0.125' }));
  });

  it('queues nothing for a Part that already existed, and saves fine without a queue', async () => {
    const { service, fileJobs, partService } = setup();
    const existing = { key: 'HAR-100', fullPartNumber: 'VR27P-1101A', seasonType: 'R', year: '27', partNumber: '1101', version: 'A', summary: 'VR27P-1101A Plate', epic: 'HAR-30', ...VALUES };
    partService.getStoriesByEpics.mockResolvedValue([existing]);
    await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item('1101')] });
    expect(fileJobs.enqueue).not.toHaveBeenCalled();

    const bare = setup({ withJobs: false });
    const { results } = await bare.service.saveBuildParts({ buildKey: 'HAR-51', creates: [item('1105')] });
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[0].filesPending).toBeUndefined();
  });
});

describe('PartService.previewParts queues files for Parts that lack them', () => {
  const part = { fullPartNumber: 'VR27P-1101A', partNumber: '1101', seasonType: 'R', year: '27', version: 'A', name: 'Tube', quantity: 1, material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'None', thickness: 'None', missing: [], origin };
  const ticket = (attachments) => ({
    key: 'HAR-10',
    fields: {
      summary: 'VR27P-1101A Tube', customfield_10110: 'HAR-1', customfield_10202: { value: 'AL 6061' }, customfield_10201: [{ value: 'CNC Router' }],
      customfield_10206: 1, ...(attachments ? { attachment: attachments.map((filename) => ({ filename })) } : {}),
    },
  });
  async function preview(attachments, bomPart = part) {
    const jiraClient = {
      getIssue: jest.fn(async (key, { fields }) => (fields.includes('issuetype')
        ? { fields: { issuetype: { name: 'Epic' } } } : { fields: { summary: 'VR27A-1100A Base Frame' } })),
      searchIssues: jest.fn().mockResolvedValue([ticket(attachments)]),
    };
    const bomService = new BOMService({ onshapeClient: {} });
    jest.spyOn(bomService, 'getBOMReport').mockResolvedValue({ parts: [bomPart], unidentified: [], subAssemblies: [] });
    const fileJobs = { enqueue: jest.fn() };
    const service = new PartService({ jiraClient, bomService, fileJobs, revisionService: { getRevisionChain: async () => ['HAR-1'] } });
    await service.previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });
    return { fileJobs, jiraClient };
  }

  it('asks for attachments in the chain search, since a default search leaves them out', async () => {
    const { jiraClient } = await preview(['VR27P-1101A.png', 'VR27P-1101A.step']);
    expect(jiraClient.searchIssues).toHaveBeenCalledWith(expect.any(String), { paginate: true, fields: ['*navigable', 'attachment'] });
  });

  it('queues a Part with no picture or no STEP, from where CAD says it is', async () => {
    const { fileJobs } = await preview(['VR27P-1101A.step']);
    expect(fileJobs.enqueue).toHaveBeenCalledWith({ key: 'HAR-10', partNumber: 'VR27P-1101A', thickness: 'None', origin });
    expect((await preview([])).fileJobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it('leaves a Part that has both, one it cannot place in OnShape, and one whose files it was not told about', async () => {
    expect((await preview(['VR27P-1101A.png', 'VR27P-1101A.step'])).fileJobs.enqueue).not.toHaveBeenCalled();
    expect((await preview([], { ...part, origin: null })).fileJobs.enqueue).not.toHaveBeenCalled();
    expect((await preview(undefined)).fileJobs.enqueue).not.toHaveBeenCalled();
  });
});
