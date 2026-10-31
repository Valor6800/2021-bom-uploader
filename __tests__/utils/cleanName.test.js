import { stripBrackets } from '../../src/server/utils/cleanName.js';

describe('stripBrackets', () => {
  it.each([
    ['[1300] Electrical', 'Electrical'],
    ['Electrical [1300]', 'Electrical'],
    ['Front [A] Plate [x]', 'Front Plate'],
    ['  Bumper  ', 'Bumper'],
    ['Base Frame', 'Base Frame'],
    ['1x1 Spacer (long)', '1x1 Spacer (long)'],
    ['[1300]', '1300'],
    ['[a] [b]', 'a b'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(stripBrackets(input)).toBe(expected);
  });

  it('returns an empty string for a non-string', () => {
    expect(stripBrackets(undefined)).toBe('');
    expect(stripBrackets(null)).toBe('');
    expect(stripBrackets(42)).toBe('');
  });
});
