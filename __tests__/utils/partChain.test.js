import { preferNewestRevision, isMoreOriginal, keyNumber } from '../../src/server/utils/partChain.js';

describe('preferNewestRevision', () => {
  const chain = ['HAR-B', 'HAR-A'];

  it('keeps the copy under the newest Revision when two tickets hold the number', () => {
    const a = { key: 'HAR-10', fullPartNumber: 'VF27P-0002A', epic: 'HAR-A' };
    const b = { key: 'HAR-20', fullPartNumber: 'VF27P-0002A', epic: 'HAR-B' };
    expect(preferNewestRevision([a, b], chain)).toEqual([b]);
    expect(preferNewestRevision([b, a], chain)).toEqual([b]);
  });

  it('keeps stories with no fullPartNumber and different numbers in order', () => {
    const x = { key: 'HAR-1', epic: 'HAR-A' };
    const p1 = { key: 'HAR-2', fullPartNumber: 'VF27P-0001A', epic: 'HAR-A' };
    const p2 = { key: 'HAR-3', fullPartNumber: 'VF27P-0003A', epic: 'HAR-B' };
    expect(preferNewestRevision([x, p1, p2], chain)).toEqual([x, p1, p2]);
  });

  it('ranks an epic outside the chain last', () => {
    const out = { key: 'HAR-1', fullPartNumber: 'VF27P-0001A', epic: 'HAR-Z' };
    const inA = { key: 'HAR-2', fullPartNumber: 'VF27P-0001A', epic: 'HAR-A' };
    expect(preferNewestRevision([out, inA], chain)).toEqual([inA]);
  });
});

describe('spares (a Part copied with the same number)', () => {
  const chain = ['HAR-A'];
  const original = { key: 'HAR-2031', fullPartNumber: 'VF27P-0001A', epic: 'HAR-A' };
  const spare = { key: 'HAR-2040', fullPartNumber: 'VF27P-0001A', epic: 'HAR-A' };

  it('keeps the original, whichever order the search returns them in', () => {
    expect(preferNewestRevision([spare, original], chain)).toEqual([original]);
    expect(preferNewestRevision([original, spare], chain)).toEqual([original]);
  });

  it('compares ticket numbers as numbers, not text', () => {
    const nine = { key: 'HAR-999', fullPartNumber: 'VF27P-0001A', epic: 'HAR-A' };
    const ten = { key: 'HAR-1000', fullPartNumber: 'VF27P-0001A', epic: 'HAR-A' };
    expect(preferNewestRevision([ten, nine], chain)).toEqual([nine]);
  });

  it('isMoreOriginal prefers the lower key and accepts anything over nothing', () => {
    expect(isMoreOriginal(original, spare)).toBe(true);
    expect(isMoreOriginal(spare, original)).toBe(false);
    expect(isMoreOriginal(spare, undefined)).toBe(true);
    expect(keyNumber('HAR-2031')).toBe(2031);
    expect(keyNumber(undefined)).toBe(Infinity);
  });
});
