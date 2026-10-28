/**
 * Reproduces the Wish-List sheet's "If we spent today?" waterfall:
 *   G2 = Overview!D2 - F2, G3 = G2 - F3, ...
 * so a bucket is funded only while that running figure stays positive.
 */
import {
  withWishListAffordability,
  projectWishList,
} from '../../src/client/src/lib/purchasingMath.js';

/** A bucket as projectWishList() leaves it. */
function bucket(wishId, remaining, overrides = {}) {
  return {
    wishId,
    item: `bucket ${wishId}`,
    allocated: remaining,
    spent: 0,
    remaining,
    pending: 0,
    projectedRemaining: remaining,
    ...overrides,
  };
}

describe('withWishListAffordability', () => {
  it('subtracts each bucket in turn, matching the sheet formula', () => {
    // $30,000 budget; Hardware allocated $2,500 leaves $27,500 for the rest.
    const result = withWishListAffordability(
      [bucket(0, 2500), bucket(1, 5000), bucket(2, 900)],
      30_000,
    );

    expect(result.map((b) => b.ifSpentToday)).toEqual([27_500, 22_500, 21_600]);
    expect(result.every((b) => b.affordable)).toBe(true);
  });

  it('marks the cutoff where the budget runs out', () => {
    const result = withWishListAffordability(
      [bucket(0, 600), bucket(1, 300), bucket(2, 500)],
      1000,
    );

    expect(result.map((b) => b.ifSpentToday)).toEqual([400, 100, -400]);
    expect(result.map((b) => b.affordable)).toEqual([true, true, false]);
  });

  it('keeps everything below the cutoff unfunded, even a cheap bucket', () => {
    const result = withWishListAffordability(
      [bucket(0, 1000), bucket(1, 5000), bucket(2, 1)],
      1200,
    );

    expect(result.map((b) => b.affordable)).toEqual([true, false, false]);
  });

  it('treats exactly zero left as still funded', () => {
    const result = withWishListAffordability([bucket(0, 1000)], 1000);

    expect(result[0].ifSpentToday).toBe(0);
    expect(result[0].affordable).toBe(true);
  });

  it('reports unknown affordability when the budget total is unavailable', () => {
    const result = withWishListAffordability([bucket(0, 100)], null);

    expect(result[0].ifSpentToday).toBeNull();
    expect(result[0].affordable).toBeNull();
  });

  it('treats a bucket with no remaining figure as claiming nothing', () => {
    const result = withWishListAffordability(
      [bucket(0, null, { remaining: null, projectedRemaining: null }), bucket(1, 400)],
      1000,
    );

    expect(result[0].ifSpentToday).toBe(1000);
    expect(result[1].ifSpentToday).toBe(600);
  });

  it('preserves input order, since sheet order is the priority order', () => {
    const result = withWishListAffordability(
      [bucket(5, 100), bucket(0, 100), bucket(3, 100)],
      1000,
    );

    expect(result.map((b) => b.wishId)).toEqual([5, 0, 3]);
  });
});

describe('affordability with a live selection', () => {
  const buckets = [
    { wishId: 0, item: 'Hardware', allocated: 2500, spent: 0, remaining: 2500 },
    { wishId: 1, item: 'COTS', allocated: 5000, spent: 0, remaining: 5000 },
  ];

  it('leaves the cutoff unmoved at and below the bucket being spent from', () => {
    // Spending $500 from COTS drops the overall total and COTS's own remaining
    // by the same $500, so COTS's figure — and everything below it — is
    // unchanged. Money moved from "allocated but unspent" to "spent".
    const before = withWishListAffordability(projectWishList(buckets, []), 30_000);

    const after = withWishListAffordability(
      projectWishList(buckets, [{ wishId: 1, price: 500, qty: 1, classification: 'Robot' }]),
      29_500,
    );

    expect(before[1].ifSpentToday).toBe(22_500);
    expect(after[1].ifSpentToday).toBe(22_500);
    expect(after[1].projectedRemaining).toBe(4500);
  });

  it('squeezes higher-priority buckets when a lower one is spent from', () => {
    const projected = projectWishList(buckets, [
      { wishId: 1, price: 500, qty: 1, classification: 'Robot' },
    ]);

    const result = withWishListAffordability(projected, 29_500);

    // Hardware is untouched by the order but has $500 less behind it.
    expect(result[0].pending).toBe(0);
    expect(result[0].ifSpentToday).toBe(27_000);
  });

  it('lowers every bucket when the order is attached to no bucket at all', () => {
    const projected = projectWishList(buckets, [
      { wishId: null, price: 1000, qty: 1, classification: 'Robot' },
    ]);

    const result = withWishListAffordability(projected, 29_000);

    expect(result.map((b) => b.ifSpentToday)).toEqual([26_500, 21_500]);
  });
});
