/**
 * Purchasing analytics — pure, I/O-free functions for the submit queue.
 *
 * Covers the four things the purchasing coordinator actually looks at:
 *   1. outlier / anomaly detection on each line
 *   2. line and batch cost (unit price x qty)
 *   3. Wish-List bucket headroom when a line is attached to one
 *   4. projected budget after the order
 *
 * Statistics note: line totals in this data are lognormal — median $45.98 with
 * a max of $1259 — so a median+MAD modified z-score on the raw values flags a
 * third of the queue. We score in log space instead, which puts the threshold
 * where a human would: 5 of 35 flagged at |z| > 2.0 on the live queue.
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** |log-space modified z| above which a line total is called unusual. */
export const LOG_Z_THRESHOLD = 2.0;

/** Fractional price change vs. history that warrants a second look. */
export const REORDER_DELTA_THRESHOLD = 0.25;

/** Share of a classification's remaining budget that warrants a warning. */
export const BUDGET_SHARE_THRESHOLD = 0.15;

/** Days in the Approved queue after which a line is called stale. */
export const AGED_DAYS_THRESHOLD = 90;

/** Constant that makes the MAD a consistent estimator of the std. deviation. */
const MAD_SCALE = 0.6745;

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export const FlagSeverity = Object.freeze({
  /** Submission is refused — the row would corrupt the sheet's budget math. */
  BLOCKER: 'blocker',
  /** Submission is allowed, but a human should confirm. */
  WARNING: 'warning',
  /** Context only. */
  INFO: 'info',
});

export const FlagCode = Object.freeze({
  MISSING_PRICE: 'missing-price',
  MISSING_QTY: 'missing-qty',
  MISSING_VENDOR: 'missing-vendor',
  PRICE_CHANGED: 'price-changed',
  HIGH_LINE_TOTAL: 'high-line-total',
  BUDGET_SHARE: 'budget-share',
  AGED: 'aged',
  DUPLICATE_PART: 'duplicate-part',
  NO_PART_NUMBER: 'no-part-number',
});

// ---------------------------------------------------------------------------
// Robust statistics
// ---------------------------------------------------------------------------

/**
 * @param {number[]} values  Non-empty array of finite numbers
 * @returns {number|null} The median, or null for an empty input
 */
export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median absolute deviation.
 *
 * @param {number[]} values
 * @param {number} [center]  Defaults to the median of `values`
 * @returns {number|null}
 */
export function medianAbsoluteDeviation(values, center) {
  const mid = center ?? median(values);
  if (mid === null) return null;
  return median(values.map((v) => Math.abs(v - mid)));
}

/**
 * Build a reusable log-space scorer from a set of historical line totals.
 *
 * Returns a `score(total)` function yielding the modified z-score, or null
 * when the total is non-positive or the history is too degenerate to score
 * against (fewer than 2 distinct values, so MAD is 0).
 *
 * @param {number[]} historicalTotals
 * @returns {{ median: number|null, mad: number|null, score: (total: number) => number|null }}
 */
export function buildLineTotalScorer(historicalTotals) {
  const logs = historicalTotals
    .filter((t) => Number.isFinite(t) && t > 0)
    .map((t) => Math.log(t));

  const mid = median(logs);
  const mad = medianAbsoluteDeviation(logs, mid ?? undefined);

  const scorable = mid !== null && mad !== null && mad > 0;

  return {
    median: mid === null ? null : Math.exp(mid),
    mad,
    score(total) {
      if (!scorable || !Number.isFinite(total) || total <= 0) return null;
      return MAD_SCALE * (Math.log(total) - mid) / mad;
    },
  };
}

// ---------------------------------------------------------------------------
// Line math
// ---------------------------------------------------------------------------

/**
 * Line total as the sheet computes it, minus shipping: unit price x qty.
 *
 * Returns null when either input is missing, which is what makes a line a
 * submission blocker — the sheet's `=(F*G)+K` would evaluate to 0 and the row
 * would silently contribute nothing to the budget.
 *
 * @param {{ price: *, qty: * }} line
 * @returns {number|null}
 */
export function lineTotal(line) {
  const { price, qty } = line;
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
  return price * qty;
}

/**
 * Sum the line totals of a set of lines, skipping unpriced ones.
 *
 * @param {{ price: *, qty: * }[]} lines
 * @returns {{ total: number, pricedCount: number, unpricedCount: number }}
 */
export function sumLineTotals(lines) {
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
 * Price change for a re-ordered part, relative to the median price previously
 * paid for the same part number.
 *
 * @param {number} currentPrice
 * @param {number[]} historicalPrices
 * @returns {{ previous: number, delta: number, sampleSize: number }|null}
 */
export function reorderDelta(currentPrice, historicalPrices) {
  if (!Number.isFinite(currentPrice)) return null;

  const priced = historicalPrices.filter((p) => Number.isFinite(p) && p > 0);
  const previous = median(priced);
  if (previous === null || previous === 0) return null;

  return {
    previous,
    delta: (currentPrice - previous) / previous,
    sampleSize: priced.length,
  };
}

/**
 * Normalize a part number for cross-ticket matching. Jira part numbers are
 * free text, so casing and internal spacing vary between orders of the same
 * item. Returns null for values that carry no identity ("", "n/a").
 *
 * @param {*} raw
 * @returns {string|null}
 */
export function normalizePartNumber(raw) {
  const collapsed = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!collapsed || collapsed === 'n/a' || collapsed === 'na') return null;
  return collapsed;
}

/**
 * Age of a line in whole days.
 *
 * @param {string|Date} created
 * @param {Date} [now]
 * @returns {number|null}
 */
export function ageInDays(created, now = new Date()) {
  const createdAt = created instanceof Date ? created : new Date(created);
  if (Number.isNaN(createdAt.getTime())) return null;
  return Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Flagging
// ---------------------------------------------------------------------------

/**
 * Evaluate every anomaly signal for one queue line.
 *
 * @param {object} params
 * @param {object} params.line                 Normalized queue line
 * @param {(total: number) => number|null} params.scoreLineTotal
 * @param {number[]} [params.historicalPrices] Prices previously paid for this part #
 * @param {number} [params.duplicateCount]     Times this part # appears in the queue
 * @param {{ remaining: number }|null} [params.budget]  Budget for the line's classification
 * @param {Date} [params.now]
 * @returns {{ code: string, severity: string, label: string, detail?: string }[]}
 */
export function flagLine({
  line,
  scoreLineTotal,
  historicalPrices = [],
  duplicateCount = 1,
  budget = null,
  now = new Date(),
}) {
  const flags = [];

  // --- Blockers: these would corrupt the sheet's budget math --------------
  if (!Number.isFinite(line.price)) {
    flags.push({
      code: FlagCode.MISSING_PRICE,
      severity: FlagSeverity.BLOCKER,
      label: 'No price',
      detail: 'Jira has no Price. The sheet Total would evaluate to 0 and the order would not count against any budget.',
    });
  }

  if (!Number.isFinite(line.qty)) {
    flags.push({
      code: FlagCode.MISSING_QTY,
      severity: FlagSeverity.BLOCKER,
      label: 'No qty',
      detail: 'Jira has no Qty. The sheet Total would evaluate to 0.',
    });
  }

  if (!line.vendorRaw || String(line.vendorRaw).trim() === '') {
    flags.push({
      code: FlagCode.MISSING_VENDOR,
      severity: FlagSeverity.BLOCKER,
      label: 'No vendor',
      detail: 'Jira has no Vendor, so the purchaser has nowhere to order from.',
    });
  }

  const total = lineTotal(line);

  // --- Price anomalies ---------------------------------------------------
  const delta = reorderDelta(line.price, historicalPrices);
  if (delta && Math.abs(delta.delta) >= REORDER_DELTA_THRESHOLD) {
    const pct = Math.round(delta.delta * 100);
    flags.push({
      code: FlagCode.PRICE_CHANGED,
      severity: FlagSeverity.WARNING,
      label: `${pct > 0 ? '+' : ''}${pct}% vs last`,
      detail: `Previously paid a median of $${delta.previous.toFixed(2)} across ${delta.sampleSize} order(s) of this part number. A large drop often means a pack size was entered as a unit price.`,
    });
  }

  if (total !== null) {
    const z = scoreLineTotal(total);
    if (z !== null && Math.abs(z) > LOG_Z_THRESHOLD) {
      flags.push({
        code: FlagCode.HIGH_LINE_TOTAL,
        severity: FlagSeverity.WARNING,
        label: z > 0 ? 'Unusually high' : 'Unusually low',
        detail: `$${total.toFixed(2)} is well outside the usual spread of line totals for this team.`,
      });
    }
  }

  // --- Budget pressure ---------------------------------------------------
  if (total !== null && budget && Number.isFinite(budget.remaining) && budget.remaining > 0) {
    const share = total / budget.remaining;
    if (share >= BUDGET_SHARE_THRESHOLD) {
      flags.push({
        code: FlagCode.BUDGET_SHARE,
        severity: FlagSeverity.WARNING,
        label: `${Math.round(share * 100)}% of ${line.classification}`,
        detail: `This single line consumes ${Math.round(share * 100)}% of the $${budget.remaining.toFixed(2)} remaining in the ${line.classification} budget.`,
      });
    }
  }

  // --- Hygiene -----------------------------------------------------------
  if (duplicateCount > 1) {
    flags.push({
      code: FlagCode.DUPLICATE_PART,
      severity: FlagSeverity.WARNING,
      label: `${duplicateCount}x in queue`,
      detail: 'The same part number appears more than once in the Approved queue. Check whether these are separate requests for the same item.',
    });
  }

  const age = ageInDays(line.created, now);
  if (age !== null && age >= AGED_DAYS_THRESHOLD) {
    flags.push({
      code: FlagCode.AGED,
      severity: FlagSeverity.INFO,
      label: `${age}d old`,
      detail: `Approved ${age} days ago. Prices and availability may have moved.`,
    });
  }

  if (normalizePartNumber(line.partNumber) === null) {
    flags.push({
      code: FlagCode.NO_PART_NUMBER,
      severity: FlagSeverity.INFO,
      label: 'No part #',
      detail: 'No usable part number, so this line cannot be price-compared against past orders.',
    });
  }

  return flags;
}

/**
 * True when a line has at least one blocker and must not be submitted.
 *
 * @param {{ severity: string }[]} flags
 * @returns {boolean}
 */
export function hasBlocker(flags) {
  return flags.some((f) => f.severity === FlagSeverity.BLOCKER);
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/**
 * Project each classification's budget after a prospective order.
 *
 * @param {{ classification: string, budget: number|null, spent: number|null, remaining: number|null }[]} budgetRows
 * @param {{ classification: string, price: *, qty: * }[]} selectedLines
 * @returns {{ classification: string, budget: number|null, spent: number|null, remaining: number|null, pending: number, projectedSpent: number|null, projectedRemaining: number|null }[]}
 */
export function projectBudget(budgetRows, selectedLines) {
  const pendingByClassification = new Map();

  for (const line of selectedLines) {
    const amount = lineTotal(line);
    if (amount === null || !line.classification) continue;
    pendingByClassification.set(
      line.classification,
      (pendingByClassification.get(line.classification) ?? 0) + amount,
    );
  }

  return budgetRows.map((row) => {
    const pending = pendingByClassification.get(row.classification) ?? 0;
    return {
      ...row,
      pending,
      projectedSpent: Number.isFinite(row.spent) ? row.spent + pending : null,
      projectedRemaining: Number.isFinite(row.remaining) ? row.remaining - pending : null,
    };
  });
}

/**
 * Project Wish-List bucket headroom for the buckets a selection touches.
 *
 * @param {{ wishId: number, item: string, allocated: number|null, spent: number|null, remaining: number|null }[]} wishList
 * @param {{ wishId: *, price: *, qty: * }[]} selectedLines
 * @returns {{ wishId: number, item: string, allocated: number|null, remaining: number|null, pending: number, projectedRemaining: number|null }[]}
 */
export function projectWishList(wishList, selectedLines) {
  const pendingByWishId = new Map();

  for (const line of selectedLines) {
    // Wish ID 0 ("Hardware") is a real bucket — compare against null/undefined
    // rather than testing truthiness.
    if (line.wishId === null || line.wishId === undefined || line.wishId === '') continue;
    const amount = lineTotal(line);
    if (amount === null) continue;

    const id = Number(line.wishId);
    pendingByWishId.set(id, (pendingByWishId.get(id) ?? 0) + amount);
  }

  return wishList
    .filter((bucket) => pendingByWishId.has(bucket.wishId))
    .map((bucket) => {
      const pending = pendingByWishId.get(bucket.wishId) ?? 0;
      return {
        ...bucket,
        pending,
        projectedRemaining: Number.isFinite(bucket.remaining)
          ? bucket.remaining - pending
          : null,
      };
    });
}
