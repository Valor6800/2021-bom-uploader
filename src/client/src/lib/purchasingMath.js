/**
 * Client-side purchasing arithmetic.
 *
 * Deliberately only the parts that must update live as the coordinator toggles
 * rows and changes a row's Classification or Wish ID — sums and subtractions.
 * The statistics (outlier z-scores, re-order price deltas) stay on the server,
 * where they are computed once against the full order history and do not change
 * with the selection.
 */

/** @param {{ price: number|null, qty: number|null }} line */
export function lineTotal(line) {
  if (!Number.isFinite(line?.price) || !Number.isFinite(line?.qty)) return null;
  return line.price * line.qty;
}

/**
 * @param {{ price: number|null, qty: number|null }[]} lines
 * @returns {{ total: number, pricedCount: number, unpricedCount: number }}
 */
export function sumLines(lines) {
  let total = 0;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const line of lines) {
    const amount = lineTotal(line);
    if (amount === null) {
      unpricedCount += 1;
      continue;
    }
    total += amount;
    pricedCount += 1;
  }

  return { total, pricedCount, unpricedCount };
}

/**
 * Per-classification budget with this order's pending spend folded in.
 *
 * @param {{ classification: string, budget: number|null, spent: number|null, remaining: number|null }[]} categories
 * @param {{ classification: string, price: number|null, qty: number|null }[]} selectedLines
 */
export function projectBudget(categories, selectedLines) {
  const pending = new Map();

  for (const line of selectedLines) {
    const amount = lineTotal(line);
    if (amount === null || !line.classification) continue;
    pending.set(line.classification, (pending.get(line.classification) ?? 0) + amount);
  }

  return categories.map((row) => {
    const amount = pending.get(row.classification) ?? 0;
    return {
      ...row,
      pending: amount,
      projectedRemaining: Number.isFinite(row.remaining) ? row.remaining - amount : null,
    };
  });
}

/**
 * Wish-List headroom with this order folded in.
 *
 * Returns every bucket, each carrying `pending` (0 when untouched) so callers
 * can either show the whole list or filter to `pending > 0`. The per-row
 * dropdown needs all of them, since it labels each option with the headroom
 * that would be left if the current selection were submitted.
 *
 * Wish ID 0 ("Hardware") is a real bucket, so emptiness is tested against
 * null/undefined/'' rather than by truthiness.
 *
 * @param {{ wishId: number, item: string, allocated: number|null, remaining: number|null }[]} wishList
 * @param {{ wishId: *, price: number|null, qty: number|null }[]} selectedLines
 */
export function projectWishList(wishList, selectedLines) {
  const pending = new Map();

  for (const line of selectedLines) {
    if (line.wishId === null || line.wishId === undefined || line.wishId === '') continue;
    const amount = lineTotal(line);
    if (amount === null) continue;

    const id = Number(line.wishId);
    pending.set(id, (pending.get(id) ?? 0) + amount);
  }

  return wishList.map((bucket) => {
    const amount = pending.get(bucket.wishId) ?? 0;
    return {
      ...bucket,
      pending: amount,
      projectedRemaining: Number.isFinite(bucket.remaining)
        ? bucket.remaining - amount
        : null,
    };
  });
}

/**
 * Overall remaining budget with this order folded in.
 *
 * Only spend in a classification that *has* an Overview row moves this, because
 * the sheet computes its own total as Budget − SUM(category spend) − reserves.
 * Summing the projected category rows rather than the raw selection keeps the
 * figure honest: a line classified VFF has no row, and genuinely does leave the
 * sheet's total untouched. See `untrackedSpend`.
 *
 * @param {{ remaining: number|null }|null} total  The Overview total row
 * @param {{ pending: number }[]} projectedCategories  From projectBudget()
 * @returns {{ remaining: number|null, pending: number, projectedRemaining: number|null }}
 */
export function projectTotalRemaining(total, projectedCategories) {
  const pending = projectedCategories.reduce((sum, row) => sum + (row.pending ?? 0), 0);

  return {
    remaining: Number.isFinite(total?.remaining) ? total.remaining : null,
    pending,
    projectedRemaining: Number.isFinite(total?.remaining)
      ? total.remaining - pending
      : null,
  };
}

/**
 * Selected spend whose Classification has no row on the Overview tab, and so
 * lands in no budget total at all.
 *
 * "VFF" is the live case: it is an accepted Classification in the Orders
 * dropdown, but Overview tracks only Voucher, Tooling, Robot, Game and
 * Business, and its grand total is SUM over those rows. Spend classified VFF
 * is therefore real money that no budget figure reflects — worth saying out
 * loud rather than quietly dropping.
 *
 * @param {{ classification: string }[]} categories  Overview category rows
 * @param {{ classification: string, price: number|null, qty: number|null }[]} selectedLines
 * @returns {{ classification: string, pending: number }[]}
 */
export function untrackedSpend(categories, selectedLines) {
  const tracked = new Set(categories.map((row) => row.classification));
  const pending = new Map();

  for (const line of selectedLines) {
    if (!line.classification || tracked.has(line.classification)) continue;
    const amount = lineTotal(line);
    if (amount === null) continue;
    pending.set(line.classification, (pending.get(line.classification) ?? 0) + amount);
  }

  return [...pending.entries()].map(([classification, amount]) => ({
    classification,
    pending: amount,
  }));
}

/**
 * Mark which Wish-List buckets the remaining budget can actually cover.
 *
 * This reproduces the sheet's "If we spent today?" column, which is a running
 * waterfall down the priority-sorted list:
 *
 *   G2 = Overview!D2 - F2        (total remaining, minus bucket 1's remaining)
 *   G3 = G2 - F3                 (then minus bucket 2's remaining)
 *   ...
 *
 * So each row answers "if we bought out this bucket and every higher-priority
 * one, what is left over?". Once that figure goes negative, that bucket and
 * everything below it is not funded. Buckets must stay in sheet order, since
 * that order *is* the priority.
 *
 * Both inputs are the projected values, so the cutoff moves live as lines are
 * selected. Note the arithmetic: attaching a line to bucket k lowers the total
 * remaining and bucket k's remaining by the same amount, so buckets at or
 * below k are unaffected while those *above* k lose headroom — spending on a
 * low-priority item really does squeeze the higher-priority ones.
 *
 * @param {{ remaining: number|null, projectedRemaining: number|null }[]} buckets
 *   In sheet/priority order, already run through projectWishList()
 * @param {number|null} projectedTotalRemaining
 * @returns {object[]} Each bucket plus `ifSpentToday` and `affordable`
 */
export function withWishListAffordability(buckets, projectedTotalRemaining) {
  let running = Number.isFinite(projectedTotalRemaining) ? projectedTotalRemaining : null;

  return buckets.map((bucket) => {
    if (running === null) {
      return { ...bucket, ifSpentToday: null, affordable: null };
    }

    const claim = Number.isFinite(bucket.projectedRemaining)
      ? bucket.projectedRemaining
      : (Number.isFinite(bucket.remaining) ? bucket.remaining : 0);

    running -= claim;

    return { ...bucket, ifSpentToday: running, affordable: running >= 0 };
  });
}

/**
 * Per-vendor voucher headroom with this order folded in.
 *
 * The spreadsheet attributes voucher spend with
 *   SUMIFS(Orders!N:N, Orders!A:A, "Voucher", Orders!D:D, <vendor>)
 * so only lines classified "Voucher" count, and they are matched to a voucher
 * row by exact vendor name.
 *
 * Selected Voucher lines whose vendor has no voucher row are returned
 * separately: that spend registers against no allocation at all, which is
 * worth surfacing rather than hiding.
 *
 * @param {{ vendor: string, budget: number|null, spent: number|null, remaining: number|null }[]} vouchers
 * @param {{ classification: string, vendor: string, price: number|null, qty: number|null }[]} selectedLines
 * @returns {{ rows: object[], unmatched: { vendor: string, pending: number }[] }}
 */
export function projectVouchers(vouchers, selectedLines) {
  const pending = new Map();

  for (const line of selectedLines) {
    if (line.classification !== 'Voucher') continue;
    const amount = lineTotal(line);
    if (amount === null) continue;
    pending.set(line.vendor, (pending.get(line.vendor) ?? 0) + amount);
  }

  const known = new Set(vouchers.map((v) => v.vendor));

  const rows = vouchers.map((voucher) => {
    const amount = pending.get(voucher.vendor) ?? 0;
    return {
      ...voucher,
      pending: amount,
      projectedRemaining: Number.isFinite(voucher.remaining)
        ? voucher.remaining - amount
        : null,
    };
  });

  const unmatched = [...pending.entries()]
    .filter(([vendor]) => !known.has(vendor))
    .map(([vendor, amount]) => ({ vendor, pending: amount }));

  return { rows, unmatched };
}

/**
 * Format a number as USD. Returns an em dash for missing values so unpriced
 * lines read as "not set" rather than "$0.00".
 *
 * @param {*} value
 * @returns {string}
 */
export function usd(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
