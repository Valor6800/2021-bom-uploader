import {
  applyTitleMask,
  applyPartMask,
  isValidPartNumber,
  formatPartNumber,
} from '../../src/server/utils/partMask.js';

describe('applyTitleMask', () => {
  test('parses a valid epic string', () => {
    const result = applyTitleMask('VR26A-0001 Drivetrain');
    expect(result).toEqual({
      summary: 'VR26A-0001 Drivetrain',
      name: 'Drivetrain',
      year: '26',
      seasonType: 'R',
      partNumber: '0001',
      fullPartNumber: 'VR26A-0001',
      isEpic: true,
    });
  });

  test('parses a facility epic', () => {
    const result = applyTitleMask('VF25A-0042 Workbench');
    expect(result).toEqual({
      summary: 'VF25A-0042 Workbench',
      name: 'Workbench',
      year: '25',
      seasonType: 'F',
      partNumber: '0042',
      fullPartNumber: 'VF25A-0042',
      isEpic: true,
    });
  });

  test('parses a part-type title (P) with isEpic false', () => {
    const result = applyTitleMask('VR26P-0010 Bracket');
    expect(result).toEqual({
      summary: 'VR26P-0010 Bracket',
      name: 'Bracket',
      year: '26',
      seasonType: 'R',
      partNumber: '0010',
      fullPartNumber: 'VR26P-0010',
      isEpic: false,
    });
  });

  test('returns null for non-matching string', () => {
    expect(applyTitleMask('Random text')).toBeNull();
    expect(applyTitleMask('')).toBeNull();
  });
});

describe('applyPartMask', () => {
  test('parses a valid part string with version', () => {
    const result = applyPartMask('VR26P-0001A Side Plate');
    expect(result).toEqual({
      summary: 'VR26P-0001A Side Plate',
      name: 'Side Plate',
      version: 'A',
      year: '26',
      seasonType: 'R',
      partNumber: '0001',
      fullPartNumber: 'VR26P-0001A',
      isEpic: false,
    });
  });

  test('parses an assembly part with version', () => {
    const result = applyPartMask('VR26A-0005B Frame Assembly');
    expect(result).toEqual({
      summary: 'VR26A-0005B Frame Assembly',
      name: 'Frame Assembly',
      version: 'B',
      year: '26',
      seasonType: 'R',
      partNumber: '0005',
      fullPartNumber: 'VR26A-0005B',
      isEpic: true,
    });
  });

  test('returns null for string without version letter', () => {
    expect(applyPartMask('VR26P-0001 No Version')).toBeNull();
  });

  test('returns null for non-matching string', () => {
    expect(applyPartMask('not a part')).toBeNull();
    expect(applyPartMask('')).toBeNull();
  });
});

describe('isValidPartNumber', () => {
  test('returns true for valid epic pattern', () => {
    expect(isValidPartNumber('VR26A-0001 Drivetrain')).toBe(true);
  });

  test('returns true for valid part pattern', () => {
    expect(isValidPartNumber('VR26P-0001A Side Plate')).toBe(true);
  });

  test('returns false for invalid strings', () => {
    expect(isValidPartNumber('random')).toBe(false);
    expect(isValidPartNumber('')).toBe(false);
  });
});

describe('formatPartNumber', () => {
  test('round-trips a part mask result', () => {
    const input = 'VR26P-0001A Side Plate';
    const parsed = applyPartMask(input);
    const formatted = formatPartNumber(parsed);
    expect(formatted).toBe(input);
  });

  test('round-trips a title mask result (epic)', () => {
    const input = 'VR26A-0001 Drivetrain';
    const parsed = applyTitleMask(input);
    const formatted = formatPartNumber(parsed);
    expect(formatted).toBe(input);
  });

  test('formats a part with no name', () => {
    const parsed = {
      seasonType: 'R',
      year: '26',
      isEpic: false,
      partNumber: '0001',
      version: 'A',
      name: '',
    };
    expect(formatPartNumber(parsed)).toBe('VR26P-0001A');
  });
});
