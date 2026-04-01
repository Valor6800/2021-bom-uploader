import {
  validateMaterial,
  validateMachinery,
  validatePowdercoat,
  validateThickness,
  validateQuantity,
  validatePartPayload,
  sanitizeJQL,
} from '../../src/server/utils/validators.js';

import {
  Material,
  Machinery,
  Powdercoat,
  Thickness,
} from '../../src/server/utils/bomConstants.js';

describe('validateMaterial', () => {
  test('accepts valid materials', () => {
    expect(validateMaterial(Material.NONE)).toEqual({ valid: true });
    expect(validateMaterial(Material.AL_6061)).toEqual({ valid: true });
    expect(validateMaterial(Material.PLA)).toEqual({ valid: true });
  });

  test('rejects invalid material', () => {
    const result = validateMaterial('Titanium');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Titanium');
  });
});

describe('validateMachinery', () => {
  test('accepts valid machinery', () => {
    expect(validateMachinery(Machinery.CNC_ROUTER)).toEqual({ valid: true });
    expect(validateMachinery(Machinery.THREE_D_PRINTER)).toEqual({ valid: true });
  });

  test('rejects invalid machinery', () => {
    const result = validateMachinery('Laser Cutter');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Laser Cutter');
  });
});

describe('validatePowdercoat', () => {
  test('accepts valid powdercoat', () => {
    expect(validatePowdercoat(Powdercoat.NONE)).toEqual({ valid: true });
    expect(validatePowdercoat(Powdercoat.BLACK)).toEqual({ valid: true });
  });

  test('rejects invalid powdercoat', () => {
    const result = validatePowdercoat('Red');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Red');
  });
});

describe('validateThickness', () => {
  test('accepts valid thickness', () => {
    expect(validateThickness(Thickness.NONE)).toEqual({ valid: true });
    expect(validateThickness(Thickness.T_0125)).toEqual({ valid: true });
  });

  test('rejects invalid thickness', () => {
    const result = validateThickness('0.500');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('0.500');
  });
});

describe('validateQuantity', () => {
  test('accepts positive integers', () => {
    expect(validateQuantity(1)).toEqual({ valid: true });
    expect(validateQuantity(100)).toEqual({ valid: true });
  });

  test('rejects zero', () => {
    expect(validateQuantity(0).valid).toBe(false);
  });

  test('rejects negative numbers', () => {
    expect(validateQuantity(-1).valid).toBe(false);
  });

  test('rejects non-integers', () => {
    expect(validateQuantity(1.5).valid).toBe(false);
    expect(validateQuantity('2').valid).toBe(false);
    expect(validateQuantity(null).valid).toBe(false);
  });
});

describe('validatePartPayload', () => {
  const validPayload = {
    material: Material.AL_6061,
    machinery: Machinery.CNC_ROUTER,
    powdercoat: Powdercoat.NONE,
    thickness: Thickness.T_0125,
    quantity: 2,
  };

  test('accepts a fully valid payload', () => {
    expect(validatePartPayload(validPayload)).toEqual({ valid: true, errors: [] });
  });

  test('collects multiple errors', () => {
    const result = validatePartPayload({
      material: 'Bad',
      machinery: 'Bad',
      powdercoat: 'Bad',
      thickness: 'Bad',
      quantity: -1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(5);
  });
});

describe('sanitizeJQL', () => {
  test('returns empty string for non-string input', () => {
    expect(sanitizeJQL(null)).toBe('');
    expect(sanitizeJQL(undefined)).toBe('');
    expect(sanitizeJQL(123)).toBe('');
  });

  test('passes through safe strings unchanged', () => {
    expect(sanitizeJQL('VR26A-0001')).toBe('VR26A-0001');
  });

  test('escapes double quotes', () => {
    expect(sanitizeJQL('test"injection')).toBe('test\\"injection');
  });

  test('escapes single quotes', () => {
    expect(sanitizeJQL("test'injection")).toBe("test\\'injection");
  });

  test('escapes parentheses and brackets', () => {
    expect(sanitizeJQL('a(b)c[d]e{f}g')).toBe('a\\(b\\)c\\[d\\]e\\{f\\}g');
  });

  test('strips control characters', () => {
    expect(sanitizeJQL('test\x00\x0a\x1fvalue')).toBe('testvalue');
  });

  test('escapes backslashes', () => {
    expect(sanitizeJQL('test\\value')).toBe('test\\\\value');
  });
});
