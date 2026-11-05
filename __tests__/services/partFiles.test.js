import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import { PartFiles } from '../../src/server/services/partFiles.js';
import { PartService } from '../../src/server/services/partService.js';
import { BuildService } from '../../src/server/services/buildService.js';
import { BOMService } from '../../src/server/services/bomService.js';
import { PartNumbers } from '../../src/server/services/partNumbers.js';
import { roundAxle } from '../fixtures/axleBody.js';

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
    // The hole goes through: the bottom has it too.
    { id: 'bottom', area: w * h - 1e-6, surface: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, -1] }, loops: [{ type: 'outer', coedges: top.map((e) => ({ edgeId: e.id })) }, { type: 'inner', coedges: [{ edgeId: 'hole' }] }] },
    { id: 'side', area: w * t, surface: { type: 'plane', origin: [0, 0, 0], normal: [0, -1, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'b' }] }] },
    { id: 'end', area: h * t, surface: { type: 'plane', origin: [w, 0, 0], normal: [1, 0, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'r' }] }] },
  ],
};
const ROUND = { id: 'JRD', faces: [{ id: 'c', area: 1, surface: { type: 'cylinder' }, loops: [] }], edges: [], vertices: [] };

const origin = { documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', partId: 'JVD', configuration: null };

function make({ attachments = [], bodies = [PLATE, ROUND], exportStep, holeScript } = {}) {
  const onshapeClient = {
    getBodyDetails: jest.fn().mockResolvedValue(bodies),
    getPartImage: jest.fn().mockResolvedValue(Buffer.from('PNG')),
    getTessellatedEdges: jest.fn().mockResolvedValue(new Map()),
    evalFeatureScript: holeScript ?? jest.fn().mockResolvedValue({ result: { typeName: 'BTFSValueArray', message: { value: [] } } }),
    // A STEP is started, then collected; `exportStep` stands for the collected file.
    startStepExport: jest.fn().mockResolvedValue('job1'),
    exportResult: exportStep ?? jest.fn().mockResolvedValue(Buffer.from('ISO-10303-21;')),
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
  it('attaches the picture, one DXF of the largest side and a drawing when the Part has a Thickness, and no STEP', async () => {
    const { files, jiraClient, onshapeClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125', machinery: 'CNC Router' });
    expect(result).toEqual({
      attached: ['VR27P-1103A.png', 'VR27P-1103A.dxf', 'VR27P-1103A_drawing.png', 'VR27P-1103A_drawings.pdf'], problems: [],
    });
    const [[, pngName, pngBody], [, dxfName, dxfBody], [, drawingName, drawingBody]] = jiraClient.addAttachment.mock.calls;
    expect([pngName, dxfName, drawingName]).toEqual(['VR27P-1103A.png', 'VR27P-1103A.dxf', 'VR27P-1103A_drawing.png']);
    // The picture is drawn from the shape read: no OnShape picture call.
    expect(Buffer.from(pngBody).subarray(1, 4).toString()).toBe('PNG');
    expect(onshapeClient.getPartImage).not.toHaveBeenCalled();
    expect(Buffer.from(drawingBody).subarray(1, 4).toString()).toBe('PNG');
    expect(dxfBody).toEqual(expect.stringContaining('SECTION'));
    expect(dxfBody).toEqual(expect.stringContaining('CIRCLE'));
    // Cut from DXFs: no STEP export at all.
    expect(onshapeClient.startStepExport).not.toHaveBeenCalled();
  });

  it('exports a 3D print\'s STEP, starting it before the other files and attaching it last', async () => {
    const { files, jiraClient, onshapeClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125', machinery: '3D Printer' });
    expect(result.attached[result.attached.length - 1]).toBe('VR27P-1103A.step');
    expect(onshapeClient.startStepExport).toHaveBeenCalledWith(origin, ['JVD']);
    expect(onshapeClient.startStepExport.mock.invocationCallOrder[0]).toBeLessThan(jiraClient.addAttachment.mock.invocationCallOrder[0]);
    expect(Buffer.from(jiraClient.addAttachment.mock.calls.at(-1)[2]).toString()).toBe('ISO-10303-21;');
  });

  it('leaves a 3D print\'s STEP to the caller when asked, and says it is needed', async () => {
    const { files, onshapeClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125', machinery: '3D Printer', step: 'later' });
    expect(result.needsStep).toBe(true);
    expect(onshapeClient.startStepExport).not.toHaveBeenCalled();
  });

  it('attaches the TOP, RIGHT and FRONT sides as DXFs when the Thickness stays None', async () => {
    const { files, jiraClient } = make();
    // A 3D print is never measured for a Thickness, so it keeps None.
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: 'None', machinery: '3D Printer' });
    expect(result.attached).toEqual([
      'VR27P-1103A.png', 'VR27P-1103A_TOP.dxf', 'VR27P-1103A_RIGHT.dxf', 'VR27P-1103A_FRONT.dxf',
      // A drawing of every view; the bottom shows the same hole as the top, so it isn't drawn again.
      'VR27P-1103A_drawing_TOP.png', 'VR27P-1103A_drawing_RIGHT.png', 'VR27P-1103A_drawing_FRONT.png',
      'VR27P-1103A_drawings.pdf',
      // A 3D print's STEP: started first, collected last.
      'VR27P-1103A.step',
    ]);
    expect(result.problems).toEqual([]);
    const dxfs = jiraClient.addAttachment.mock.calls.filter(([, name]) => name.endsWith('.dxf'));
    expect(dxfs).toHaveLength(3);
    for (const [, , body] of dxfs) expect(body).toEqual(expect.stringContaining('ENTITIES'));
  });

  it('treats a missing Thickness like None', async () => {
    const { files } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, machinery: '3D Printer' });
    expect(result.attached.filter((n) => n.endsWith('.dxf'))).toHaveLength(3);
  });

  it('adds only what the ticket is missing', async () => {
    const { files, jiraClient } = make({ attachments: ['VR27P-1103A.png', 'VR27P-1103A_drawing.png', 'VR27P-1103A_drawings.pdf'] });
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result.attached).toEqual(['VR27P-1103A.dxf']);
    expect(jiraClient.addAttachment).toHaveBeenCalledTimes(1);
  });

  it('attaches only a STEP for a 3D-printed part with nothing to draw (no flat side, no edges)', async () => {
    const { files, jiraClient } = make();
    const result = await files.attach({
      key: 'HAR-9', partNumber: 'VR27P-1104A', origin: { ...origin, partId: 'JRD' }, thickness: 'None', machinery: '3D Printer',
    });
    expect(result).toEqual({ attached: ['VR27P-1104A.step'], problems: [] });
    expect(jiraClient.addAttachment).toHaveBeenCalledTimes(1);
  });

  it('makes the drawing when it is the only file missing', async () => {
    const { files, jiraClient } = make({ attachments: ['VR27P-1103A.png', 'VR27P-1103A.dxf'] });
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result).toEqual({ attached: ['VR27P-1103A_drawing.png', 'VR27P-1103A_drawings.pdf'], problems: [] });
    const [[, name, body]] = jiraClient.addAttachment.mock.calls;
    expect(name).toBe('VR27P-1103A_drawing.png');
    expect(Buffer.from(body).subarray(1, 4).toString()).toBe('PNG');
  });

  it('adds only the drawing in a backfill, with no picture or STEP call', async () => {
    const { files, onshapeClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125', drawingOnly: true });
    expect(result).toEqual({ attached: ['VR27P-1103A_drawing.png', 'VR27P-1103A_drawings.pdf'], problems: [] });
    expect(onshapeClient.getPartImage).not.toHaveBeenCalled();
    expect(onshapeClient.exportPartStep).not.toHaveBeenCalled();
  });

  it('draws a round axle, though it has no flat side for a DXF', async () => {
    const m = (inch) => inch * 0.0254;
    const axle = { ...roundAxle({ L: m(4), lengths: [{ from: 0, to: m(4), d: m(0.5) }] }), id: 'JAX' };
    const { files, jiraClient, onshapeClient } = make({ bodies: [PLATE, axle] });
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1105A', origin: { ...origin, partId: 'JAX' }, thickness: 'None' });
    expect(result).toEqual({ attached: ['VR27P-1105A.png', 'VR27P-1105A_drawing.png', 'VR27P-1105A_drawings.pdf'], problems: [] });
    expect(Buffer.from(jiraClient.addAttachment.mock.calls[1][2]).subarray(1, 4).toString()).toBe('PNG');
    expect(onshapeClient.getBodyDetails).toHaveBeenCalledTimes(1);
  });

  it('reads the plate face\'s curves once for its DXF and its drawing', async () => {
    const { files, onshapeClient } = make();
    const spline = { id: 'b', curve: { type: 'spline' }, geometry: { startPoint: [0, 0, t], endPoint: [w, 0, t] } };
    const bodies = [{ ...PLATE, edges: PLATE.edges.map((e) => (e.id === 'b' ? spline : e)) }];
    onshapeClient.getBodyDetails.mockResolvedValue(bodies);
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result.attached).toEqual(['VR27P-1103A.png', 'VR27P-1103A.dxf', 'VR27P-1103A_drawing.png', 'VR27P-1103A_drawings.pdf']);
    expect(onshapeClient.getTessellatedEdges).toHaveBeenCalledTimes(1);
  });

  it('never asks OnShape for a picture: a part with nothing to draw goes without one', async () => {
    const { files, onshapeClient } = make();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1104A', origin: { ...origin, partId: 'JRD' }, thickness: 'None' });
    expect(result.attached).not.toContain('VR27P-1104A.png');
    expect(result.problems).toEqual([]);
    expect(onshapeClient.getPartImage).not.toHaveBeenCalled();
  });

  it('still attaches the DXF when the STEP fails, and says which failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = Object.assign(new Error('boom'), { name: 'OnshapeApiError', status: 502 });
    const { files } = make({ exportStep: jest.fn().mockRejectedValue(failure) });
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125', machinery: '3D Printer' });
    expect(result.attached).toEqual(['VR27P-1103A.png', 'VR27P-1103A.dxf', 'VR27P-1103A_drawing.png', 'VR27P-1103A_drawings.pdf']);
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

describe('PartFiles.attach on a plate whose back differs', () => {
  it('adds the rear: its DXF seen from the back and its drawing', async () => {
    // The hole only on the top: from the back there is nothing there.
    const blind = { ...PLATE, faces: PLATE.faces.map((f) => (f.id === 'bottom' ? { ...f, loops: [f.loops[0]] } : f)) };
    const { files } = make({ bodies: [blind], attachments: ['VR27P-1103A.png', 'VR27P-1103A.step'] });
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: '0.125' });
    expect(result.attached).toEqual([
      'VR27P-1103A.dxf', 'VR27P-1103A_REAR.dxf',
      'VR27P-1103A_drawing.png', 'VR27P-1103A_drawing_REAR.png', 'VR27P-1103A_drawings.pdf',
    ]);
  });
});

describe('PartFiles.attach on a pocketed plate', () => {
  it('attaches the through cuts and one DXF per pocket depth, measured from one shape read', async () => {
    const pocketed = JSON.parse(readFileSync(new URL('../fixtures/pocketedPlate.json', import.meta.url)));
    const { files, onshapeClient } = make({ bodies: [pocketed], attachments: ['VR26P-2204C.png', 'VR26P-2204C.step'] });
    const result = await files.attach({
      key: 'HAR-9', partNumber: 'VR26P-2204C', origin: { ...origin, partId: pocketed.id }, thickness: '0.375',
    });
    expect(result).toEqual({
      attached: [
        'VR26P-2204C.dxf', 'VR26P-2204C_POCKET_0.125.dxf', 'VR26P-2204C_POCKET_0.250.dxf', 'VR26P-2204C_POCKET_0.3125.dxf',
        'VR26P-2204C_drawing.png', 'VR26P-2204C_drawings.pdf',
      ],
      problems: [],
    });
    expect(onshapeClient.getBodyDetails).toHaveBeenCalledTimes(1);
  });
});

describe('PartFiles.attachSteps: one STEP export for a Part Studio\'s 3D prints', () => {
  const zip = readFileSync(new URL('../fixtures/stepExport.zip', import.meta.url));
  const studio = { documentId: 'd', wvmType: 'v', wvmId: 'v', elementId: 'e' };
  const parts = [
    { key: 'HAR-1', partNumber: 'VR27P-1201A', partId: 'RABD', name: 'PulleyAxle' },
    { key: 'HAR-2', partNumber: 'VR27P-1202A', partId: 'RdBD', name: '1stStageAxle' },
  ];

  it('exports them together and gives each Part its own file from the zip', async () => {
    const { files, onshapeClient, jiraClient } = make({ exportStep: jest.fn().mockResolvedValue(zip) });
    const results = await files.attachSteps(studio, parts);
    expect(onshapeClient.startStepExport).toHaveBeenCalledTimes(1);
    expect(onshapeClient.startStepExport).toHaveBeenCalledWith(studio, ['RABD', 'RdBD']);
    expect(results.get('HAR-1')).toEqual({ attached: ['VR27P-1201A.step'], problems: [] });
    expect(results.get('HAR-2')).toEqual({ attached: ['VR27P-1202A.step'], problems: [] });
    const sizes = Object.fromEntries(jiraClient.addAttachment.mock.calls.map(([key, , data]) => [key, data.length]));
    expect(sizes).toEqual({ 'HAR-1': 21696, 'HAR-2': 21863 });
  });

  it('exports alone a Part the zip has no file for', async () => {
    const { files, onshapeClient } = make({ exportStep: jest.fn().mockResolvedValue(zip) });
    const results = await files.attachSteps(studio, [...parts, { key: 'HAR-3', partNumber: 'VR27P-1203A', partId: 'X', name: 'Missing' }]);
    expect(results.get('HAR-3').attached).toEqual(['VR27P-1203A.step']);
    expect(onshapeClient.exportPartStep).toHaveBeenCalledWith({ ...studio, partId: 'X' });
  });

  it('says so for every Part when the export fails, and never throws', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const down = Object.assign(new Error('x'), { name: 'OnshapeApiError', status: 504 });
    const { files } = make({ exportStep: jest.fn().mockRejectedValue(down) });
    const results = await files.attachSteps(studio, parts);
    expect(results.get('HAR-1').problems).toHaveLength(1);
    expect(results.get('HAR-2').problems).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('PartFiles.attach sets Needs Tapping? from the Hole feature when the Build is cut', () => {
  const tapped = readFileSync(new URL('../fixtures/tappedPart.json', import.meta.url));
  const fixture = JSON.parse(tapped);
  const run = async ({ tapping = 'No', holeScript } = {}) => {
    const m = make({
      bodies: [fixture.body],
      holeScript: holeScript ?? jest.fn().mockResolvedValue(fixture.holeScriptResponse),
    });
    m.jiraClient.updateIssue = jest.fn().mockResolvedValue(undefined);
    const result = await m.files.attach({
      key: 'HAR-9', partNumber: 'VR27P-1106A', origin: { ...origin, partId: fixture.body.id }, thickness: 'None', tapping,
    });
    return { ...m, result };
  };

  it('sets Yes when the part has a tapped Hole, reading the Part Studio once', async () => {
    const { result, jiraClient, onshapeClient } = await run();
    expect(result.tapping).toBe('Yes');
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('HAR-9', { customfield_10600: { value: 'Yes' } });
    expect(onshapeClient.evalFeatureScript).toHaveBeenCalledTimes(1);
  });

  it('leaves it as it is when no Hole is tapped, and never sets No', async () => {
    const none = jest.fn().mockResolvedValue({ result: { typeName: 'BTFSValueArray', message: { value: [] } } });
    const { result, jiraClient } = await run({ holeScript: none });
    expect(result.tapping).toBeUndefined();
    expect(jiraClient.updateIssue).not.toHaveBeenCalledWith('HAR-9', expect.objectContaining({ customfield_10600: expect.anything() }));
  });

  it('says so, and still attaches the files, when the holes can\'t be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const down = jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'OnshapeApiError', status: 502 }));
    const { result } = await run({ holeScript: down });
    expect(result.problems.some((p) => p.startsWith('Needs Tapping?'))).toBe(true);
    expect(result.attached).toContain('VR27P-1106A.png');
    warn.mockRestore();
  });
});

describe('PartFiles.attach sets Thickness when the Build is cut', () => {
  const withUpdate = () => {
    const m = make();
    m.jiraClient.updateIssue = jest.fn().mockResolvedValue(undefined);
    return m;
  };

  it('measures a Part still at None, writes its Thickness, and makes a plate\'s files', async () => {
    const { files, jiraClient, onshapeClient } = withUpdate();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: 'None', machinery: 'CNC Router' });
    expect(result.thickness).toBe('0.125');
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('HAR-9', { customfield_10207: { value: '0.125' } });
    // One DXF of the largest side, and a plate drawing: no TOP/RIGHT/FRONT.
    expect(result.attached).toEqual(expect.arrayContaining(['VR27P-1103A.dxf', 'VR27P-1103A_drawing.png', 'VR27P-1103A_drawings.pdf']));
    expect(result.attached.some((n) => n.includes('_TOP'))).toBe(false);
    // Measured from the same shape read the DXF uses.
    expect(onshapeClient.getBodyDetails).toHaveBeenCalledTimes(1);
  });

  it('leaves a Part that has a Thickness, a 3D print, and one already measured', async () => {
    for (const params of [
      { thickness: '0.250' },
      { thickness: 'None', machinery: '3D Printer' },
    ]) {
      const { files, jiraClient } = withUpdate();
      // eslint-disable-next-line no-await-in-loop
      const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, ...params });
      expect(result.thickness).toBeUndefined();
      expect(jiraClient.updateIssue).not.toHaveBeenCalled();
    }
    const { files, jiraClient } = withUpdate();
    jiraClient.getIssue.mockResolvedValue({ fields: { attachment: [{ filename: 'VR27P-1103A_TOP.dxf' }] } });
    await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: 'None' });
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  });

  it('leaves it None when nothing matches a stock thickness', async () => {
    const { files, jiraClient } = withUpdate();
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1104A', origin: { ...origin, partId: 'JRD' }, thickness: 'None' });
    expect(result.thickness).toBeUndefined();
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  });

  it('still attaches the files when the Thickness can\'t be saved, and says so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { files, jiraClient } = withUpdate();
    jiraClient.updateIssue.mockRejectedValue(Object.assign(new Error('x'), { name: 'JiraApiError', status: 503 }));
    const result = await files.attach({ key: 'HAR-9', partNumber: 'VR27P-1103A', origin, thickness: 'None' });
    expect(result.problems[0]).toMatch(/^Thickness 0.125:/);
    expect(result.attached).toContain('VR27P-1103A.png');
    warn.mockRestore();
  });
});

describe('BuildService.saveBuildParts does not touch OnShape files (that waits for Cut Version)', () => {
  const VALUES = { quantity: 2, material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'None', thickness: 'None' };
  const BUILD = { fields: { issuetype: { name: 'Build' }, status: { name: 'Draft' }, customfield_10110: 'HAR-30', customfield_10501: 1 } };
  const item = (number, extra = {}) => ({ ref: `VR27P-${number}A`, summary: `VR27P-${number}A Plate`, revision: 'A', ...VALUES, ...extra });

  function setup() {
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
    const fileJobs = { enqueue: jest.fn(() => true) };
    const service = new BuildService({
      jiraClient, partService, fileJobs, revisionService: { getRevisionChain: async () => ['HAR-30'] },
    });
    return { service, fileJobs, partService };
  }

  it('creates the Part tickets but queues no files and marks nothing pending', async () => {
    const { service, fileJobs } = setup();
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item('1101'), item('1102')] });
    expect(fileJobs.enqueue).not.toHaveBeenCalled();
    expect(results.map((r) => [r.key, r.ok, r.filesPending])).toEqual([['HAR-3000', true, undefined], ['HAR-3001', true, undefined]]);
  });

  it('saves fine with no fileJobs dependency at all', async () => {
    const jiraClient = { getIssue: jest.fn(async () => BUILD), searchIssues: jest.fn().mockResolvedValue([]), createIssueLink: jest.fn().mockResolvedValue(undefined) };
    const partService = { getStoriesByEpics: jest.fn().mockResolvedValue([]), createStory: jest.fn(async () => ({ key: 'HAR-9000' })) };
    const service = new BuildService({ jiraClient, partService, revisionService: { getRevisionChain: async () => ['HAR-30'] } });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item('1105')] });
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[0].filesPending).toBeUndefined();
  });
});

describe('BuildService._queuePartFiles — files are queued once the Build is cut', () => {
  function setup({ stories = [] } = {}) {
    const fileJobs = { enqueue: jest.fn(() => true) };
    const partService = { getStoriesByKeys: jest.fn().mockResolvedValue(stories) };
    const service = new BuildService({ jiraClient: {}, fileJobs, partService });
    return { service, fileJobs, partService };
  }

  it('queues a job for every Part linked to the Build, by number and thickness only (no origin)', async () => {
    const { service, fileJobs, partService } = setup({
      stories: [
        { key: 'HAR-100', fullPartNumber: 'VR27P-1101A', thickness: '0.125' },
        { key: 'HAR-101', fullPartNumber: 'VR27P-1102A', thickness: 'None' },
      ],
    });
    service.getLinkedParts = jest.fn().mockResolvedValue(['HAR-100', 'HAR-101']);
    await service._queuePartFiles('HAR-51', 'HAR-30', 'https://cad.onshape.com/documents/d/v/v/e/e');
    expect(partService.getStoriesByKeys).toHaveBeenCalledWith(['HAR-100', 'HAR-101']);
    expect(fileJobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      key: 'HAR-100', partNumber: 'VR27P-1101A', thickness: '0.125', assemblyKey: 'HAR-30',
      versionLink: 'https://cad.onshape.com/documents/d/v/v/e/e',
    }));
    expect(fileJobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ key: 'HAR-101', thickness: 'None' }));
  });

  it('does nothing for a Build with no linked Parts, and never throws without fileJobs/partService', async () => {
    const { service, fileJobs, partService } = setup();
    service.getLinkedParts = jest.fn().mockResolvedValue([]);
    await service._queuePartFiles('HAR-51', 'HAR-30');
    expect(partService.getStoriesByKeys).not.toHaveBeenCalled();
    expect(fileJobs.enqueue).not.toHaveBeenCalled();

    const bare = new BuildService({ jiraClient: {} });
    expect(() => bare._queuePartFiles('HAR-51', 'HAR-30')).not.toThrow();
  });
});

describe('PartService.previewParts does not touch OnShape files (Update from CAD is read-only on files)', () => {
  const part = { fullPartNumber: 'VR27P-1101A', partNumber: '1101', seasonType: 'R', year: '27', version: 'A', name: 'Tube', quantity: 1, material: 'AL 6061', machinery: 'CNC Router', powdercoat: 'None', thickness: 'None', missing: [], origin };
  const ticket = {
    key: 'HAR-10',
    fields: {
      summary: 'VR27P-1101A Tube', customfield_10110: 'HAR-1', customfield_10202: { value: 'AL 6061' }, customfield_10201: [{ value: 'CNC Router' }],
      customfield_10206: 1,
    },
  };

  it('never calls fileJobs.enqueue, even for a Part with no picture or STEP yet', async () => {
    const jiraClient = {
      getIssue: jest.fn(async (key, { fields }) => (fields.includes('issuetype')
        ? { fields: { issuetype: { name: 'Epic' } } } : { fields: { summary: 'VR27A-1100A Base Frame' } })),
      searchIssues: jest.fn().mockResolvedValue([ticket]),
    };
    const bomService = new BOMService({ onshapeClient: {} });
    jest.spyOn(bomService, 'getBOMReport').mockResolvedValue({ parts: [part], unidentified: [], subAssemblies: [] });
    // PartService no longer accepts a fileJobs dependency at all.
    const service = new PartService({ jiraClient, bomService, revisionService: { getRevisionChain: async () => ['HAR-1'] } });
    const result = await service.previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });
    expect(result.existingParts).toHaveLength(1);
    expect(service.fileJobs).toBeUndefined();
  });
});
