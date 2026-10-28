import {
  median,
  medianAbsoluteDeviation,
  buildLineTotalScorer,
  lineTotal,
  sumLineTotals,
  reorderDelta,
  normalizePartNumber,
  ageInDays,
  flagLine,
  hasBlocker,
  projectBudget,
  projectWishList,
  FlagCode,
  FlagSeverity,
  LOG_Z_THRESHOLD,
} from '../../src/server/utils/purchasingAnalytics.js';

describe('median', () => {
  it('returns the middle value for odd-length input', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for even-length input', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns null for empty input', () => {
    expect(median([])).toBeNull();
  });

  it('ignores non-finite values', () => {
    expect(median([1, NaN, 3, undefined, 2])).toBe(2);
  });

  it('does not mutate the caller array', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('medianAbsoluteDeviation', () => {
  it('measures spread around the median', () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });

  it('is zero for identical values', () => {
    expect(medianAbsoluteDeviation([7, 7, 7])).toBe(0);
  });
});

describe('buildLineTotalScorer', () => {
  it('reports the median in dollars, not log space', () => {
    const scorer = buildLineTotalScorer([10, 100, 1000]);
    expect(scorer.median).toBeCloseTo(100, 6);
  });

  it('scores an extreme value above the threshold and a typical one below', () => {
    // A spread roughly like the real order history.
    const history = [5, 10, 15, 20, 30, 45, 60, 90, 120, 200];
    const scorer = buildLineTotalScorer(history);

    expect(Math.abs(scorer.score(45))).toBeLessThan(LOG_Z_THRESHOLD);
    expect(scorer.score(25_000)).toBeGreaterThan(LOG_Z_THRESHOLD);
  });

  it('returns null when history is too degenerate to score against', () => {
    const scorer = buildLineTotalScorer([50, 50, 50]);
    expect(scorer.score(5000)).toBeNull();
  });

  it('returns null for non-positive or missing totals', () => {
    const scorer = buildLineTotalScorer([10, 20, 40, 80]);
    expect(scorer.score(0)).toBeNull();
    expect(scorer.score(-5)).toBeNull();
    expect(scorer.score(null)).toBeNull();
  });

  it('ignores non-positive history entries rather than producing NaN', () => {
    const scorer = buildLineTotalScorer([0, -3, 10, 20, 40, 80]);
    expect(Number.isFinite(scorer.score(20))).toBe(true);
  });
});

describe('lineTotal', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineTotal({ price: 4.99, qty: 10 })).toBeCloseTo(49.9, 6);
  });

  it('returns null when price is missing', () => {
    expect(lineTotal({ price: null, qty: 3 })).toBeNull();
  });

  it('returns null when quantity is missing', () => {
    expect(lineTotal({ price: 10, qty: null })).toBeNull();
  });

  it('treats a zero price as a real value, not a missing one', () => {
    expect(lineTotal({ price: 0, qty: 5 })).toBe(0);
  });
});

describe('sumLineTotals', () => {
  it('sums priced lines and counts unpriced ones separately', () => {
    const result = sumLineTotals([
      { price: 10, qty: 2 },
      { price: null, qty: 4 },
      { price: 5, qty: 1 },
    ]);

    expect(result).toEqual({ total: 25, pricedCount: 2, unpricedCount: 1 });
  });

  it('handles an empty list', () => {
    expect(sumLineTotals([])).toEqual({ total: 0, pricedCount: 0, unpricedCount: 0 });
  });
});

describe('reorderDelta', () => {
  it('reports a price drop as a negative fraction', () => {
    const result = reorderDelta(4.99, [13.99, 14.99]);
    expect(result.previous).toBeCloseTo(14.49, 6);
    expect(result.delta).toBeLessThan(-0.6);
    expect(result.sampleSize).toBe(2);
  });

  it('reports no change as zero', () => {
    expect(reorderDelta(249.99, [249.99, 249.99]).delta).toBe(0);
  });

  it('returns null without usable history', () => {
    expect(reorderDelta(10, [])).toBeNull();
    expect(reorderDelta(10, [0, -1])).toBeNull();
  });

  it('returns null when the current price is missing', () => {
    expect(reorderDelta(null, [10, 20])).toBeNull();
  });
});

describe('normalizePartNumber', () => {
  it('lowercases and strips internal whitespace', () => {
    expect(normalizePartNumber(' WCP-1713 ')).toBe('wcp-1713');
    expect(normalizePartNumber('S-24285BL/R')).toBe('s-24285bl/r');
    expect(normalizePartNumber('1/4 inches x 2 1/4')).toBe('1/4inchesx21/4');
  });

  it('treats placeholders as absent', () => {
    expect(normalizePartNumber('')).toBeNull();
    expect(normalizePartNumber('   ')).toBeNull();
    expect(normalizePartNumber('n/a')).toBeNull();
    expect(normalizePartNumber('N/A')).toBeNull();
    expect(normalizePartNumber(null)).toBeNull();
  });
});

describe('ageInDays', () => {
  it('counts whole days since creation', () => {
    const now = new Date('2026-10-28T00:00:00Z');
    expect(ageInDays('2026-10-18T00:00:00Z', now)).toBe(10);
  });

  it('returns null for an unparseable date', () => {
    expect(ageInDays('not-a-date')).toBeNull();
  });
});

describe('flagLine', () => {
  const neverFlags = () => null;

  const baseLine = {
    key: 'PARTS-1',
    price: 20,
    qty: 2,
    vendorRaw: 'WCP',
    partNumber: 'WCP-1',
    classification: 'Robot',
    created: new Date().toISOString(),
  };

  it('blocks a line with no price', () => {
    const flags = flagLine({ line: { ...baseLine, price: null }, scoreLineTotal: neverFlags });
    const codes = flags.map((f) => f.code);

    expect(codes).toContain(FlagCode.MISSING_PRICE);
    expect(hasBlocker(flags)).toBe(true);
  });

  it('blocks a line with no quantity', () => {
    const flags = flagLine({ line: { ...baseLine, qty: null }, scoreLineTotal: neverFlags });
    expect(flags.map((f) => f.code)).toContain(FlagCode.MISSING_QTY);
    expect(hasBlocker(flags)).toBe(true);
  });

  it('blocks a line with no vendor', () => {
    const flags = flagLine({ line: { ...baseLine, vendorRaw: '  ' }, scoreLineTotal: neverFlags });
    expect(flags.map((f) => f.code)).toContain(FlagCode.MISSING_VENDOR);
    expect(hasBlocker(flags)).toBe(true);
  });

  it('warns on a large re-order price change', () => {
    const flags = flagLine({
      line: { ...baseLine, price: 4.99 },
      scoreLineTotal: neverFlags,
      historicalPrices: [13.99, 14.99],
    });

    const flag = flags.find((f) => f.code === FlagCode.PRICE_CHANGED);
    expect(flag).toBeDefined();
    expect(flag.severity).toBe(FlagSeverity.WARNING);
    expect(flag.label).toMatch(/-6[0-9]% vs last/);
  });

  it('does not warn on a small re-order price change', () => {
    const flags = flagLine({
      line: { ...baseLine, price: 27.08 },
      scoreLineTotal: neverFlags,
      historicalPrices: [26.03],
    });

    expect(flags.map((f) => f.code)).not.toContain(FlagCode.PRICE_CHANGED);
  });

  it('warns when a line consumes a large share of its budget', () => {
    const flags = flagLine({
      line: { ...baseLine, price: 1259, qty: 1, classification: 'Tooling' },
      scoreLineTotal: neverFlags,
      budget: { remaining: 5705.61 },
    });

    const flag = flags.find((f) => f.code === FlagCode.BUDGET_SHARE);
    expect(flag).toBeDefined();
    expect(flag.label).toBe('22% of Tooling');
  });

  it('ignores budget share when the budget is already exhausted', () => {
    const flags = flagLine({
      line: baseLine,
      scoreLineTotal: neverFlags,
      budget: { remaining: 0 },
    });

    expect(flags.map((f) => f.code)).not.toContain(FlagCode.BUDGET_SHARE);
  });

  it('warns on a duplicate part number in the queue', () => {
    const flags = flagLine({ line: baseLine, scoreLineTotal: neverFlags, duplicateCount: 3 });
    const flag = flags.find((f) => f.code === FlagCode.DUPLICATE_PART);

    expect(flag.label).toBe('3x in queue');
  });

  it('notes an aged line as info, not a blocker', () => {
    const flags = flagLine({
      line: { ...baseLine, created: '2026-01-01T00:00:00Z' },
      scoreLineTotal: neverFlags,
      now: new Date('2026-10-28T00:00:00Z'),
    });

    const flag = flags.find((f) => f.code === FlagCode.AGED);
    expect(flag.severity).toBe(FlagSeverity.INFO);
    expect(hasBlocker(flags)).toBe(false);
  });

  it('notes a missing part number as info', () => {
    const flags = flagLine({
      line: { ...baseLine, partNumber: 'n/a' },
      scoreLineTotal: neverFlags,
    });

    expect(flags.find((f) => f.code === FlagCode.NO_PART_NUMBER).severity)
      .toBe(FlagSeverity.INFO);
  });

  it('produces no flags for an ordinary line', () => {
    expect(flagLine({ line: baseLine, scoreLineTotal: neverFlags })).toEqual([]);
  });
});

describe('projectBudget', () => {
  const categories = [
    { classification: 'Robot', budget: 29221, spent: 1385.21, remaining: 27835.79 },
    { classification: 'Tooling', budget: 6000, spent: 294.39, remaining: 5705.61 },
  ];

  it('subtracts selected spend from the right classification', () => {
    const result = projectBudget(categories, [
      { classification: 'Tooling', price: 1259, qty: 1 },
    ]);

    const tooling = result.find((r) => r.classification === 'Tooling');
    expect(tooling.pending).toBe(1259);
    expect(tooling.projectedRemaining).toBeCloseTo(4446.61, 6);
    expect(tooling.projectedSpent).toBeCloseTo(1553.39, 6);

    const robot = result.find((r) => r.classification === 'Robot');
    expect(robot.pending).toBe(0);
    expect(robot.projectedRemaining).toBeCloseTo(27835.79, 6);
  });

  it('can project a classification into the negative', () => {
    const result = projectBudget(categories, [
      { classification: 'Tooling', price: 6000, qty: 1 },
    ]);

    expect(result.find((r) => r.classification === 'Tooling').projectedRemaining)
      .toBeLessThan(0);
  });

  it('skips unpriced lines', () => {
    const result = projectBudget(categories, [
      { classification: 'Robot', price: null, qty: 4 },
    ]);

    expect(result.find((r) => r.classification === 'Robot').pending).toBe(0);
  });
});

describe('projectWishList', () => {
  const wishList = [
    { wishId: 0, item: 'Hardware', allocated: 2500, spent: 0, remaining: 2500 },
    { wishId: 4, item: 'Tapping arm', allocated: 1500, spent: 0, remaining: 1500 },
  ];

  it('only returns buckets the selection touches', () => {
    const result = projectWishList(wishList, [
      { wishId: 4, price: 1259, qty: 1 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].item).toBe('Tapping arm');
    expect(result[0].projectedRemaining).toBe(241);
  });

  it('treats Wish ID 0 as a real bucket', () => {
    const result = projectWishList(wishList, [
      { wishId: 0, price: 100, qty: 2 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].wishId).toBe(0);
    expect(result[0].pending).toBe(200);
  });

  it('ignores lines with no bucket attached', () => {
    expect(projectWishList(wishList, [
      { wishId: null, price: 10, qty: 1 },
      { wishId: '', price: 10, qty: 1 },
      { wishId: undefined, price: 10, qty: 1 },
    ])).toEqual([]);
  });

  it('accumulates several lines into one bucket', () => {
    const result = projectWishList(wishList, [
      { wishId: 0, price: 50, qty: 2 },
      { wishId: 0, price: 25, qty: 4 },
    ]);

    expect(result[0].pending).toBe(200);
    expect(result[0].projectedRemaining).toBe(2300);
  });
});
