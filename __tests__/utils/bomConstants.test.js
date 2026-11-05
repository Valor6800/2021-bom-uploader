import {
  Material,
  Machinery,
  Powdercoat,
  Thickness,
  MATERIALS,
  MACHINERY,
  POWDERCOAT,
  THICKNESS,
  MATERIAL_MACHINERY_MAP,
} from '../../src/server/utils/bomConstants.js';

describe('BOM Constants', () => {
  test('MATERIALS contains expected values', () => {
    expect(MATERIALS).toContain(Material.NONE);
    expect(MATERIALS).toContain(Material.AL_6061);
    expect(MATERIALS).toContain(Material.PLA);
    expect(MATERIALS).toContain(Material.PETG_CF);
    expect(MATERIALS).toContain(Material.NYLON);
    expect(MATERIALS).toContain(Material.WOOD);
    expect(MATERIALS).toContain(Material.POLYCARB);
    expect(MATERIALS).toContain(Material.SRPP);
    expect(MATERIALS).toContain(Material.AL_7075);
  });

  test('MACHINERY contains expected values', () => {
    expect(MACHINERY).toContain(Machinery.NONE);
    expect(MACHINERY).toContain(Machinery.CNC_MILL);
    expect(MACHINERY).toContain(Machinery.CNC_ROUTER);
    expect(MACHINERY).toContain(Machinery.MANUAL_MILL);
    expect(MACHINERY).toContain(Machinery.MANUAL_LATHE);
    expect(MACHINERY).toContain(Machinery.THREE_D_PRINTER);
    expect(MACHINERY).toContain(Machinery.MANUAL);
  });

  test('POWDERCOAT contains expected values', () => {
    expect(POWDERCOAT).toEqual([Powdercoat.NONE, Powdercoat.BLACK, Powdercoat.GOLD]);
  });

  test('THICKNESS contains expected values', () => {
    expect(THICKNESS).toEqual([
      Thickness.NONE, Thickness.T_0060, Thickness.T_0090,
      Thickness.T_0125, Thickness.T_01875, Thickness.T_0250, Thickness.T_0375,
    ]);
  });

  test('MATERIAL_MACHINERY_MAP values reference valid MATERIALS and MACHINERY', () => {
    for (const [key, { material, machinery }] of Object.entries(MATERIAL_MACHINERY_MAP)) {
      expect(MATERIALS).toContain(material);
      expect(MACHINERY).toContain(machinery);
    }
  });

  test('MATERIAL_MACHINERY_MAP contains all expected mappings', () => {
    expect(MATERIAL_MACHINERY_MAP['6061']).toEqual({ material: Material.AL_6061, machinery: Machinery.CNC_ROUTER });
    expect(MATERIAL_MACHINERY_MAP['pla']).toEqual({ material: Material.PLA, machinery: Machinery.THREE_D_PRINTER });
    expect(MATERIAL_MACHINERY_MAP['petg']).toEqual({ material: Material.PETG_CF, machinery: Machinery.THREE_D_PRINTER });
    expect(MATERIAL_MACHINERY_MAP['nylon']).toEqual({ material: Material.NYLON, machinery: Machinery.THREE_D_PRINTER });
    expect(MATERIAL_MACHINERY_MAP['birch']).toEqual({ material: Material.WOOD, machinery: Machinery.CNC_ROUTER });
    expect(MATERIAL_MACHINERY_MAP['wood']).toEqual({ material: Material.WOOD, machinery: Machinery.CNC_ROUTER });
    expect(MATERIAL_MACHINERY_MAP['polycarbonate']).toEqual({ material: Material.POLYCARB, machinery: Machinery.CNC_ROUTER });
    expect(MATERIAL_MACHINERY_MAP['polypropylene']).toEqual({ material: Material.SRPP, machinery: Machinery.CNC_ROUTER });
    expect(MATERIAL_MACHINERY_MAP['7075']).toEqual({ material: Material.AL_7075, machinery: Machinery.MANUAL_LATHE });
  });

  test('enum objects are frozen', () => {
    expect(Object.isFrozen(Material)).toBe(true);
    expect(Object.isFrozen(Machinery)).toBe(true);
    expect(Object.isFrozen(Powdercoat)).toBe(true);
    expect(Object.isFrozen(Thickness)).toBe(true);
  });
});
