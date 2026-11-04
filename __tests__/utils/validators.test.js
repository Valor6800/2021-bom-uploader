import {
  validateMaterial,
  validateMachinery,
  validatePowdercoat,
  validateTapping,
  validateThickness,
  validateQuantity,
  validatePartPayload,
  sanitizeJQL,
  validateIssueKey,
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

describe('validateTapping', () => {
  test('accepts No and Yes', () => {
    expect(validateTapping('No')).toEqual({ valid: true });
    expect(validateTapping('Yes')).toEqual({ valid: true });
  });

  test('rejects anything else', () => {
    const result = validateTapping('None');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('None');
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

describe('validateIssueKey', () => {
  const saved = { PROJECT_KEY: process.env.PROJECT_KEY, JIRA_PROJECT: process.env.JIRA_PROJECT };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('accepts a key in the project', () => {
    process.env.PROJECT_KEY = 'HAR';
    expect(validateIssueKey('HAR-2030')).toEqual({ valid: true });
  });

  test('honours a PROJECT_KEY set after import', () => {
    process.env.PROJECT_KEY = 'VAL';
    expect(validateIssueKey('HAR-2030').valid).toBe(false);
    process.env.PROJECT_KEY = 'HAR';
    expect(validateIssueKey('HAR-2030').valid).toBe(true);
  });

  test('falls back to JIRA_PROJECT, then VAL', () => {
    delete process.env.PROJECT_KEY;
    process.env.JIRA_PROJECT = 'HAR';
    expect(validateIssueKey('HAR-1').valid).toBe(true);
    delete process.env.JIRA_PROJECT;
    expect(validateIssueKey('VAL-1').valid).toBe(true);
    expect(validateIssueKey('HAR-1').valid).toBe(false);
  });

  test.each([
    'har-2030', 'HAR-', 'HAR-12345678', '-1', '1HAR-1', 'HAR-1 OR 1=1', 'HAR-1"', '', null, 42, ['HAR-1'],
  ])('rejects %p', (key) => {
    process.env.PROJECT_KEY = 'HAR';
    const result = validateIssueKey(key);
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('rejects another project with a message naming the project', () => {
    process.env.PROJECT_KEY = 'HAR';
    expect(validateIssueKey('VAL-1')).toEqual({ valid: false, error: '"VAL-1" is not in project HAR' });
  });
});
