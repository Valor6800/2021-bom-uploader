import {
  isValidSource,
  SOURCES,
  DEFAULT_SOURCE,
} from '../../src/server/utils/purchasingConstants.js';

describe('isValidSource', () => {
  it('accepts the listed funding sources', () => {
    expect(isValidSource('LISD')).toBe(true);
    expect(isValidSource('VFF')).toBe(true);
  });

  it('accepts blank, meaning no funding source recorded', () => {
    expect(isValidSource('')).toBe(true);
    expect(isValidSource(null)).toBe(true);
    expect(isValidSource(undefined)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidSource('lisd')).toBe(false);
    expect(isValidSource('Grant')).toBe(false);
    expect(isValidSource(0)).toBe(false);
  });
});

describe('Source constants', () => {
  it('matches the sheet dropdown', () => {
    expect(SOURCES).toEqual(['LISD', 'VFF']);
  });

  it('defaults to nothing recorded, so the source is always chosen deliberately', () => {
    expect(DEFAULT_SOURCE).toBe('');
    expect(isValidSource(DEFAULT_SOURCE)).toBe(true);
  });
});
