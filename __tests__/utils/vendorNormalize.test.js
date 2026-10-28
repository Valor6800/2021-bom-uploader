import {
  normalizeVendor,
  isUnusableVendor,
  vendorKey,
  groupByVendor,
  UNKNOWN_VENDOR,
} from '../../src/server/utils/vendorNormalize.js';

describe('vendorKey', () => {
  it('collapses case, spacing and punctuation', () => {
    expect(vendorKey('McMaster-Carr')).toBe('mcmastercarr');
    expect(vendorKey('  West Coast Products ')).toBe('westcoastproducts');
    expect(vendorKey('Thrifty Bot')).toBe('thriftybot');
  });

  it('handles nullish input', () => {
    expect(vendorKey(null)).toBe('');
    expect(vendorKey(undefined)).toBe('');
  });
});

describe('isUnusableVendor', () => {
  it('rejects blanks', () => {
    expect(isUnusableVendor('')).toBe(true);
    expect(isUnusableVendor('   ')).toBe(true);
    expect(isUnusableVendor(null)).toBe(true);
  });

  it('rejects bare numbers, which appear where a price was typed by mistake', () => {
    expect(isUnusableVendor('25.99')).toBe(true);
    expect(isUnusableVendor('$15.99')).toBe(true);
  });

  it('accepts real vendor names', () => {
    expect(isUnusableVendor('WCP')).toBe(false);
    expect(isUnusableVendor('3dxtech')).toBe(false);
  });
});

describe('normalizeVendor', () => {
  it('collapses every observed McMaster spelling', () => {
    for (const raw of ['McMaster', 'Mcmaster', 'McMaster-Carr', 'McMaster Carr', 'mcmaster', 'MCM', 'MMC']) {
      expect(normalizeVendor(raw)).toBe('McMaster-Carr');
    }
  });

  it('collapses WCP spellings', () => {
    expect(normalizeVendor('WCP')).toBe('WCP');
    expect(normalizeVendor('West Coast Products')).toBe('WCP');
  });

  it('collapses Thrifty Bot spellings, including the typo', () => {
    for (const raw of ['Thrifty Bot', 'Thriftybot', 'ThriftyBot', 'TTB', 'ThrifyBot', 'Thrifty']) {
      expect(normalizeVendor(raw)).toBe('Thrifty');
    }
  });

  it('collapses Amazon spellings', () => {
    expect(normalizeVendor('amazon')).toBe('Amazon');
    expect(normalizeVendor('amazon.com')).toBe('Amazon');
  });

  /**
   * The Overview tab tracks voucher spend with
   *   SUMIFS(Orders!N:N, Orders!A:A, "Voucher", Orders!D:D, <vendor label>)
   * so for any vendor with a voucher row, the canonical name has to match that
   * label exactly or the spend registers against no allocation.
   */
  it('spells voucher vendors the way the Overview tab spells them', () => {
    expect(normalizeVendor('Rev')).toBe('Rev');
    expect(normalizeVendor('Rev Robotics')).toBe('Rev');
    expect(normalizeVendor('REV')).toBe('Rev');
    expect(normalizeVendor('AndyMark')).toBe('Andymark');
    expect(normalizeVendor('Andymark')).toBe('Andymark');
    expect(normalizeVendor('Thriftybot')).toBe('Thrifty');
    expect(normalizeVendor('WCP')).toBe('WCP');
    expect(normalizeVendor('West Coast Products')).toBe('WCP');
    expect(normalizeVendor('Fabworks')).toBe('Fabworks');
    expect(normalizeVendor('Online Metals')).toBe('Online Metals');
    expect(normalizeVendor('Westbrook')).toBe('Westbrook');
  });

  it('maps unusable values to a single bucket', () => {
    expect(normalizeVendor('')).toBe(UNKNOWN_VENDOR);
    expect(normalizeVendor('25.99')).toBe(UNKNOWN_VENDOR);
  });

  it('passes an unknown vendor through, trimmed', () => {
    expect(normalizeVendor('  Some New Supplier ')).toBe('Some New Supplier');
  });

  it('groups two spellings of an unknown vendor together when they match exactly', () => {
    expect(normalizeVendor('New Co')).toBe(normalizeVendor(' New Co '));
  });
});

describe('groupByVendor', () => {
  it('groups by canonical name across spellings', () => {
    const items = [
      { key: 'A', vendor: 'McMaster' },
      { key: 'B', vendor: 'Mcmaster' },
      { key: 'C', vendor: 'WCP' },
    ];

    const groups = groupByVendor(items, (i) => i.vendor);

    expect(groups).toHaveLength(2);
    const mcmaster = groups.find((g) => g.vendor === 'McMaster-Carr');
    expect(mcmaster.items.map((i) => i.key)).toEqual(['A', 'B']);
  });

  it('sorts groups by vendor name', () => {
    const groups = groupByVendor(
      [{ v: 'WCP' }, { v: 'Amazon' }, { v: 'DigiKey' }],
      (i) => i.v,
    );

    expect(groups.map((g) => g.vendor)).toEqual(['Amazon', 'DigiKey', 'WCP']);
  });

  it('returns an empty array for no items', () => {
    expect(groupByVendor([], (i) => i.v)).toEqual([]);
  });
});
