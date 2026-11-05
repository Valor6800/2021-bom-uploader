import fs from 'node:fs';
import { analyzeBody } from '../../src/server/utils/partGeometry.js';
import { axleFeatures, plateFeatures } from '../../src/server/utils/partFeatures.js';
import { holesByPart } from '../../src/server/utils/holeFeatures.js';
import { roundAxle } from '../fixtures/axleBody.js';

// Real body details from the Climber's Gearbox Part Studio (trimmed: the
// plate keeps only its flat faces and their edges).
const REAL = JSON.parse(fs.readFileSync(new URL('../fixtures/gearboxBodies.json', import.meta.url)));
const IN = 25.4;
const inches = (mm) => Number((mm / IN).toFixed(3));

describe('plateFeatures, on a real gearbox plate', () => {
  const body = REAL.GearboxPlateOuterLeft;
  const f = plateFeatures(body, analyzeBody(body));

  it('measures it as its DXF does', () => {
    expect(f.kind).toBe('plate');
    expect(inches(f.width)).toBe(7.072);
    expect(inches(f.height)).toBe(6.537);
    expect(inches(f.thickness)).toBe(0.125);
  });

  it('finds every round hole, grouped by size, largest first', () => {
    expect(f.groups.map((g) => [g.letter, inches(g.d), g.count])).toEqual([
      ['A', 1.125, 1], ['B', 1, 1], ['C', 0.65, 1], ['D', 0.196, 15],
    ]);
    expect(f.holes).toHaveLength(18);
    expect(f.cutouts).toBe(20);
  });

  it('places each hole from the lower left, inside the plate, and tags it', () => {
    const a1 = f.holes.find((h) => h.tag === 'A1');
    expect([inches(a1.x), inches(a1.y)]).toEqual([4.332, 1.457]);
    for (const h of f.holes) {
      expect(h.x).toBeGreaterThan(0);
      expect(h.y).toBeGreaterThan(0);
      expect(h.x).toBeLessThan(f.width);
      expect(h.y).toBeLessThan(f.height);
    }
    expect(new Set(f.holes.map((h) => h.tag)).size).toBe(18);
    expect(f.holes.filter((h) => h.tag.startsWith('D')).map((h) => h.tag)).toContain('D15');
  });
});

describe('axleFeatures, on real axles', () => {
  it('reads PulleyAxle: 1/2 rounded hex, 6.938 long, a Ø0.201 bore through', () => {
    const f = axleFeatures(REAL.PulleyAxle);
    expect(f.kind).toBe('axle');
    expect(inches(f.length)).toBe(6.938);
    expect(f.stock.shape).toBe('rounded hex');
    expect(inches(f.stock.acrossFlats)).toBe(0.5);
    expect(inches(f.stock.diameter)).toBe(0.541);
    expect(f.sections).toHaveLength(1);
    // Its size alone says nothing about tapping: that comes from the Hole feature.
    expect(f.bores.map((b) => [b.end, inches(b.d), b.tap])).toEqual([['through', 0.201, null]]);
    expect(f.crossHoles).toEqual([]);
    expect(f.endView.holes.map((h) => inches(h.d))).toEqual([0.201]);
    expect(inches(f.endView.width)).toBe(0.5);
  });

  it('reads IdlerDeadAxle: 3/8 rounded hex, 2 long, bored through', () => {
    const f = axleFeatures(REAL.IdlerDeadAxle);
    expect(inches(f.length)).toBe(2);
    expect(f.stock.shape).toBe('rounded hex');
    expect(inches(f.stock.acrossFlats)).toBe(0.375);
    expect(f.bores.map((b) => [b.end, inches(b.d)])).toEqual([['through', 0.17]]);
  });

  it('is not fooled by a long block with holes across it', () => {
    expect(axleFeatures(REAL.WCPNutBlock)).toBeNull();
  });

  it('is not fooled by a plate', () => {
    expect(axleFeatures(REAL.GearboxPlateOuterLeft)).toBeNull();
  });
});

describe('axleFeatures, on a turned axle', () => {
  const m = (inch) => inch * 0.0254;
  const body = roundAxle({
    L: m(4),
    lengths: [
      { from: 0, to: m(0.5), d: m(0.375) },
      { from: m(0.5), to: m(3.5), d: m(0.5) },
      { from: m(3.5), to: m(3.55), d: m(0.46) },
      { from: m(3.55), to: m(4), d: m(0.5) },
    ],
    bores: [{ from: 0, to: m(0.75), d: m(0.159) }],
    cross: [{ at: m(2), d: m(0.125) }],
  });
  const f = axleFeatures(body);

  it('finds each length at its size, from the left end', () => {
    expect(f.sections.map((s) => [inches(s.from), inches(s.to), s.shape, inches(s.diameter)])).toEqual([
      [0, 0.5, 'round', 0.375],
      [0.5, 3.5, 'round', 0.5],
      [3.5, 3.55, 'round', 0.46],
      [3.55, 4, 'round', 0.5],
    ]);
    expect(f.stock).toEqual(expect.objectContaining({ shape: 'round' }));
    expect(inches(f.stock.diameter)).toBe(0.5);
  });

  it('finds a blind bore in the left end and a hole across', () => {
    expect(f.bores.map((b) => [b.end, inches(b.d), inches(b.depth), b.tap])).toEqual([['left', 0.159, 0.75, null]]);
    expect(f.crossHoles.map((h) => [inches(h.at), inches(h.d)])).toEqual([[2, 0.125]]);
  });

  it('turns down a short, fat part', () => {
    expect(axleFeatures(roundAxle({ L: m(0.5), lengths: [{ from: 0, to: m(0.5), d: m(1) }] }))).toBeNull();
  });
});

describe('tapping from the Hole feature (real Part 1: three Ø0.201 holes, two tapped 1/4-20)', () => {
  const { body, holeScriptResponse } = JSON.parse(fs.readFileSync(new URL('../fixtures/tappedPart.json', import.meta.url)));
  const faces = holesByPart(holeScriptResponse).get(body.id);

  it('tells a tapped 0.201 from a clearance 0.201', () => {
    const f = plateFeatures(body, analyzeBody(body), undefined, faces);
    expect(f.holeData).toBe(true);
    expect(f.groups.map((g) => [g.letter, inches(g.d), g.count, g.tap, g.tapDepth])).toEqual([
      ['A', 0.201, 2, '1/4-20', null],
      ['B', 0.201, 1, null, null],
    ]);
    expect(inches(f.groups[0].major)).toBe(0.25);
  });

  it('taps nothing when the Hole feature was not read, whatever the sizes', () => {
    const f = plateFeatures(body, analyzeBody(body));
    expect(f.holeData).toBe(false);
    expect(f.groups.map((g) => [inches(g.d), g.count, g.tap])).toEqual([[0.201, 3, null]]);
  });

  it('taps an axle bore the Hole feature tapped', () => {
    const axle = axleFeatures(REAL.PulleyAxle, undefined, [{
      faceId: REAL.PulleyAxle.faces.find((fc) => fc.surface.type === 'cylinder' && fc.orientation === false).id,
      tapped: true, tapSize: '1/4-20', through: false, depth: 0.0127, major: 0.00635,
    }]);
    expect(axle.bores.map((b) => [b.tap, inches(b.tapDepth)])).toEqual([['1/4-20', 0.5]]);
  });
});
