import fs from 'node:fs';
import { analyzeBody } from '../../src/server/utils/partGeometry.js';
import { axleFeatures, plateFeatures, threadMajor } from '../../src/server/utils/partFeatures.js';
import { drawingPdf, fraction, tapNotes } from '../../src/server/utils/partDrawing.js';

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
    expect(pages(await drawingPdf(plate, { partNumber: 'VR27P-4102A' }))).toBe(2);
  });

  it('draws an axle on one page', async () => {
    const pdf = await drawingPdf(axleFeatures(REAL.PulleyAxle), { partNumber: 'VR27P-4103A', tapping: 'Yes', material: 'AL 6061' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(1);
  });
});

describe('tapNotes', () => {
  const plate = { kind: 'plate', groups: [
    { letter: 'A', d: 28.575, count: 1, tap: null },
    { letter: 'D', d: 0.159 * 25.4, count: 19, tap: '#10-32' },
  ] };
  const axle = (tap) => ({ kind: 'axle', bores: [{ end: 'through', d: 0.201 * 25.4, depth: 100, tap }], crossHoles: [] });

  it('says which holes to tap, and how, when the Part needs tapping', () => {
    expect(tapNotes(plate, 'Yes').map((n) => n.text)).toEqual([
      'Tap 19 D holes #10-32 (drilled Ø0.159).',
      'Tapped holes go through the plate unless the designer says otherwise.',
    ]);
    expect(tapNotes(plate, 'Yes').some((n) => n.warn)).toBe(false);
  });

  it('warns when holes are tap drill size but the Part says No', () => {
    expect(tapNotes(plate, 'No')).toEqual([{
      text: '19 holes are tap drill size (#10-32), but Needs Tapping? is No. Ask the designer before cutting.', warn: true,
    }]);
  });

  it('warns when the Part says Yes but no hole could be tapped', () => {
    const [note] = tapNotes({ ...plate, groups: [plate.groups[0]] }, 'Yes');
    expect(note).toEqual(expect.objectContaining({ warn: true }));
    expect(note.text).toContain('no hole is a tap drill size');
  });

  it('says nothing when nothing is or could be tapped', () => {
    expect(tapNotes({ ...plate, groups: [plate.groups[0]] }, 'No')).toEqual([]);
    expect(tapNotes(axle(null), 'No')).toEqual([]);
  });

  it('taps an axle\'s through bore at both ends, and says its depth is not in the model', () => {
    const texts = tapNotes(axle('1/4-20'), 'Yes').map((n) => n.text);
    expect(texts[0]).toBe('Tap the bore 1/4-20 (drilled Ø0.201).');
    expect(texts[1]).toContain('both ends');
  });
});

describe('threadMajor', () => {
  it('gives a thread\'s outside diameter', () => {
    expect(threadMajor('1/4-20')).toBeCloseTo(6.35);
    expect(threadMajor('#10-32')).toBeCloseTo(4.826);
    expect(threadMajor('M6')).toBeNull();
  });
});

describe('the title block', () => {
  it('still draws a part number too long for it', async () => {
    const pdf = await drawingPdf(axleFeatures(REAL.PulleyAxle), { partNumber: 'VR27P-4106A-WITH-A-VERY-LONG-NUMBER-INDEED', tapping: 'Yes' });
    expect(pages(pdf)).toBe(1);
  });
});
