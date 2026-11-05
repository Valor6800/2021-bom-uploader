import fs from 'node:fs';
import { colorFrom, DEFAULT_COLOR, isoPicture } from '../../src/server/utils/isoPicture.js';

const GEARBOX = JSON.parse(fs.readFileSync(new URL('../fixtures/gearboxBodies.json', import.meta.url)));
const size = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe('isoPicture', () => {
  it('draws a real axle and block as a PNG of the size asked for', () => {
    for (const body of [GEARBOX.PulleyAxle, GEARBOX.WCPNutBlock]) {
      const png = isoPicture(body, { width: 400, height: 300 });
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(size(png)).toEqual([400, 300]);
    }
  });

  it('draws something, not a blank page', () => {
    const plain = isoPicture({ faces: [], edges: [] }, { width: 50, height: 40 });
    const axle = isoPicture(GEARBOX.PulleyAxle, { width: 50, height: 40 });
    expect(axle.length).toBeGreaterThan(plain.length);
  });
});

describe('colorFrom', () => {
  it('takes the BOM\'s colour, or steel grey without one', () => {
    expect(colorFrom({ color: { red: 200, green: 100, blue: 50 } })).toEqual([200, 100, 50]);
    expect(colorFrom(null)).toEqual(DEFAULT_COLOR);
    expect(colorFrom({ color: { red: 'x' } })).toEqual(DEFAULT_COLOR);
  });

  it('lifts a black part to charcoal so its shading shows, keeping its hue', () => {
    const [r, g, b] = colorFrom({ color: { red: 10, green: 10, blue: 14 } });
    expect(Math.max(r, g, b)).toBeGreaterThanOrEqual(78);
    expect(b - r).toBe(4);
  });
});
