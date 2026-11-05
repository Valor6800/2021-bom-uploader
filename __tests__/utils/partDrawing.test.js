import fs from 'node:fs';
import { analyzeBody } from '../../src/server/utils/partGeometry.js';
import { axleFeatures, plateFeatures } from '../../src/server/utils/partFeatures.js';
import { drawingPdf, drawingsPdf, fraction, tapNotes } from '../../src/server/utils/partDrawing.js';
import { allSides, analyzeBody as analyze } from '../../src/server/utils/partGeometry.js';
import { faceFeatures } from '../../src/server/utils/partFeatures.js';
import { pngOfPdf } from '../../src/server/utils/drawingPng.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../fixtures/gearboxBodies.json', import.meta.url)));
const pages = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('fraction', () => {
  it('writes a whole number of sixteenths as a fraction', () => {
    expect(fraction(0.5 * 25.4)).toBe('1/2');
    expect(fraction(0.375 * 25.4)).toBe('3/8');
    expect(fraction(1.25 * 25.4)).toBe('1 1/4');
    expect(fraction(2 * 25.4)).toBe('2');
  });
  it('writes anything else as decimal inches', () => {
    expect(fraction(0.541 * 25.4)).toBe('0.541');
  });
});

describe('drawingPdf', () => {
  it('draws a plate on one page', async () => {
    const body = REAL.GearboxPlateOuterLeft;
    const pdf = await drawingPdf(plateFeatures(body, analyzeBody(body)), { partNumber: 'VR27P-4101A', tapping: 'No' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(1);
  });

  it('carries a long hole chart on to more pages', async () => {
    const holes = Array.from({ length: 200 }, (_, i) => ({ tag: `A${i + 1}`, x: 5 + (i % 20) * 10, y: 5 + Math.floor(i / 20) * 10, d: 4, tap: null }));
    const plate = {
      kind: 'plate', width: 210, height: 110, thickness: 3.175, cutouts: 0, holes,
      groups: [{ letter: 'A', d: 4, count: 200, tap: null }],
      entities: [['LINE', [0, 0], [210, 0]], ['LINE', [210, 0], [210, 110]], ['LINE', [210, 110], [0, 110]], ['LINE', [0, 110], [0, 0]],
        ...holes.map((h) => ['CIRCLE', [h.x, h.y], 2])],
    };
    const pdf = await drawingPdf(plate, { partNumber: 'VR27P-4102A' });
    expect(pages(pdf)).toBe(2);
    // The picture holds every page, one under the other.
    const png = await pngOfPdf(pdf, { scale: 1 });
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([792, 1224]);
  });

  it('draws an axle on one page', async () => {
    const pdf = await drawingPdf(axleFeatures(REAL.PulleyAxle), { partNumber: 'VR27P-4103A', tapping: 'Yes', material: 'AL 6061' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(1);
  });
});

describe('tapNotes', () => {
  const plate = (groups, holeData = true) => ({ kind: 'plate', holeData, groups });
  const tappedGroup = { letter: 'A', d: 0.201 * 25.4, count: 2, tap: '1/4-20', major: 6.35, tapDepth: null };
  const plain = { letter: 'B', d: 0.201 * 25.4, count: 1, tap: null };

  it('calls out the holes the Hole feature tapped, through or to a depth', () => {
    expect(tapNotes(plate([tappedGroup, plain]), 'Yes')).toEqual([{ text: 'Tap 2 A holes 1/4-20 through (drilled Ø0.201).' }]);
    expect(tapNotes(plate([{ ...tappedGroup, tapDepth: 12.7 }]), 'Yes')[0].text).toBe('Tap 2 A holes 1/4-20 x 0.500 deep (drilled Ø0.201).');
  });

  it('never guesses from a hole\'s size', () => {
    expect(tapNotes(plate([plain]), 'No')).toEqual([]);
  });

  it('warns when the Part says Yes but the model has no tapped hole', () => {
    const [note] = tapNotes(plate([plain]), 'Yes');
    expect(note).toEqual(expect.objectContaining({ warn: true }));
    expect(note.text).toContain('no hole in the model is a tapped Hole');
    expect(tapNotes(plate([plain], false), 'Yes')[0].text).toContain('could not be read');
  });

  it('taps an axle bore at both ends when it goes to a depth', () => {
    const axle = { kind: 'axle', bores: [{ end: 'through', d: 5.1, depth: 100, tap: '1/4-20', tapDepth: 12.7 }], crossHoles: [] };
    expect(tapNotes(axle, 'Yes')[0].text).toBe('Tap the bore 1/4-20 both ends x 0.500 deep (drilled Ø0.201).');
  });
});

describe('the title block', () => {
  it('still draws a part number too long for it', async () => {
    const pdf = await drawingPdf(axleFeatures(REAL.PulleyAxle), { partNumber: 'VR27P-4106A-WITH-A-VERY-LONG-NUMBER-INDEED', tapping: 'Yes' });
    expect(pages(pdf)).toBe(1);
  });
});

describe('drawingsPdf', () => {
  it('puts every drawing of a part in one PDF, a face\'s with its side and stock', async () => {
    const { body } = JSON.parse(fs.readFileSync(new URL('../fixtures/tappedPart.json', import.meta.url)));
    const a = analyze(body);
    const faces = allSides(body, a).slice(0, 3).map((side) => faceFeatures(body, side, undefined, null, a));
    expect(faces.map((f) => [f.kind, f.side])).toEqual([['face', 'TOP'], ['face', 'BOTTOM'], ['face', 'RIGHT']]);
    expect(faces[0].stock.map((d) => (d / 25.4).toFixed(3))).toEqual(['1.890', '1.176', '1.000']);
    const pdf = await drawingsPdf([...faces, axleFeatures(REAL.PulleyAxle)], { partNumber: 'VR27P-4107A' });
    expect(pages(pdf)).toBe(4);
  });
});
