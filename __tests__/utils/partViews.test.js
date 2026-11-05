import fs from 'node:fs';
import { allSides, analyzeBody, faceLayout } from '../../src/server/utils/partGeometry.js';
import { isPlain, plateRearView, sameFeatures, sideViewPlan } from '../../src/server/utils/partViews.js';
import { plateViews } from '../../src/server/utils/partGeometry.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const GEARBOX = read('gearboxBodies.json');
const { body: BLOCK } = read('tappedPart.json');
const POCKETED = read('pocketedPlate.json');
const plan = (body, kind) => sideViewPlan(body, analyzeBody(body), kind)
  .map((e) => [e.name, e.plain ? 'plain' : 'features', e.dxf]);

describe('partViews', () => {
  it('draws a block with holes through it from three sides; plain ones get no DXF', () => {
    // Real "Part 1": three holes through from the top, so the bottom shows the same and isn't drawn again.
    expect(plan(BLOCK, { plate: false, axle: false })).toEqual([
      ['TOP', 'features', true], ['RIGHT', 'plain', false], ['FRONT', 'plain', false],
    ]);
  });

  it('adds an opposite side that shows other features', () => {
    // The WCP nut block: tapped from one side, countersunk from the other.
    expect(plan(GEARBOX.WCPNutBlock, { plate: false, axle: false })).toEqual([
      ['TOP', 'features', true], ['BOTTOM', 'features', true], ['RIGHT', 'plain', false],
      ['FRONT', 'features', true], ['BACK', 'features', true],
    ]);
  });

  it('leaves an axle to its own drawing, ends included', () => {
    expect(plan(GEARBOX.PulleyAxle, { plate: false, axle: true })).toEqual([]);
  });

  it('adds no edge views to a plate whose edges have nothing in them', () => {
    expect(plan(POCKETED, { plate: true, axle: false })).toEqual([]);
  });

  it('adds no rear to a plate pocketed from one side: its back is the through cuts', () => {
    const a = analyzeBody(POCKETED);
    expect(plateRearView(POCKETED, a, plateViews(POCKETED, a).profile)).toBeNull();
  });

  it('finds all six sides of a block', () => {
    expect(allSides(BLOCK, analyzeBody(BLOCK)).map((s) => s.name).sort())
      .toEqual(['BACK', 'BOTTOM', 'FRONT', 'LEFT', 'RIGHT', 'TOP']);
  });

  it('calls a rectangle with nothing in it plain', () => {
    const sides = new Map(allSides(BLOCK, analyzeBody(BLOCK)).map((s) => [s.name, s]));
    expect(isPlain(faceLayout(BLOCK, sides.get('RIGHT')))).toBe(true);
    expect(isPlain(faceLayout(BLOCK, sides.get('TOP')))).toBe(false);
    expect(sameFeatures(BLOCK, sides.get('TOP'), sides.get('BOTTOM'))).toBe(true);
  });
});
