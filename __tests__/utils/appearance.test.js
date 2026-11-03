import { powdercoatFromAppearance, toHsl } from '../../src/server/utils/appearance.js';

const rgb = (red, green, blue) => ({ color: { red, green, blue }, opacity: 255 });

describe('powdercoatFromAppearance', () => {
  it.each([
    ['pure black', rgb(0, 0, 0)],
    ["a student's near-black (36, 36, 35)", rgb(36, 36, 35)],
    ['a dark grey', rgb(50, 50, 50)],
    ['a very dark blue', rgb(10, 10, 40)],
  ])('reads %s as Black', (_, appearance) => {
    expect(powdercoatFromAppearance(appearance)).toBe('Black');
  });

  it.each([
    ['textbook gold', rgb(255, 215, 0)],
    ['a duller gold', rgb(212, 175, 55)],
    ['a bronze-ish gold', rgb(200, 160, 50)],
    ['a pale gold', rgb(230, 190, 90)],
  ])('reads %s as Gold', (_, appearance) => {
    expect(powdercoatFromAppearance(appearance)).toBe('Gold');
  });

  it.each([
    ['OnShape default grey', rgb(230, 230, 230)],
    ['mid grey', rgb(128, 128, 128)],
    ['white', rgb(255, 255, 255)],
    ['red', rgb(220, 20, 20)],
    ['blue', rgb(30, 90, 200)],
    ['pure yellow', rgb(255, 255, 0)],
    ['orange', rgb(255, 120, 0)],
    ['khaki, too grey to be gold', rgb(190, 180, 140)],
  ])('reads %s as no powdercoat', (_, appearance) => {
    expect(powdercoatFromAppearance(appearance)).toBe('None');
  });

  it('reads a missing or broken appearance as no powdercoat', () => {
    expect(powdercoatFromAppearance(undefined)).toBe('None');
    expect(powdercoatFromAppearance({})).toBe('None');
    expect(powdercoatFromAppearance({ color: { red: 'x' } })).toBe('None');
  });

  it('converts to hue, saturation and lightness', () => {
    expect(toHsl({ red: 255, green: 0, blue: 0 })).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(toHsl({ red: 128, green: 128, blue: 128 }).s).toBe(0);
  });
});
