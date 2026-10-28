/**
 * Centralized constants for the parts-purchasing workflow: the Jira PARTS
 * project's fields and transitions, and the Orders sheet's column layout.
 *
 * Single source of truth for Purchasing Service, Order Sheet Service, the
 * purchasing routes, and (mirrored) the React frontend.
 */

// ---------------------------------------------------------------------------
// Jira — project, fields, statuses, transitions
// ---------------------------------------------------------------------------

/**
 * The purchasing project. Deliberately separate from PROJECT_KEY (HAR), which
 * the Assembly BOM flow uses for manufactured parts.
 */
export const PARTS_PROJECT_KEY = process.env.PARTS_PROJECT_KEY ?? 'PARTS';

/** Custom field IDs on a PARTS "Part" issue. */
export const PartField = Object.freeze({
  EPIC_LINK: 'customfield_10110',
  PART_NUMBER: 'customfield_10203',
  PRICE: 'customfield_10205',
  QTY: 'customfield_10206',
  VENDOR: 'customfield_10208',
  LINK: 'customfield_10200',
});

/** Workflow status names on the Part Orders board. */
export const PartStatus = Object.freeze({
  NEW: 'New',
  REQUEST_FOR_PURCHASE: 'Request for Purchase',
  APPROVED: 'Approved',
  SENT_TO_VFF: 'Sent to VFF',
  ORDERED: 'Ordered',
  DELIVERED: 'Delivered',
});

/**
 * Transition IDs. Jira has no direct Sent to VFF -> Delivered edge, so
 * receiving an item still sitting in Sent to VFF requires ORDERED then
 * DELIVERED in sequence.
 */
export const PartTransition = Object.freeze({
  SENT_TO_VFF: '81',   // Approved     -> Sent to VFF  ("Email sent to VFF")
  ORDERED: '101',      // Sent to VFF  -> Ordered
  DELIVERED: '111',    // Ordered      -> Delivered
});

// ---------------------------------------------------------------------------
// Orders sheet — layout
// ---------------------------------------------------------------------------

/**
 * Zero-based column indices on the Orders tab.
 *
 * TOTAL is read-only to us: the sheet pre-fills `=(F{r}*G{r})+K{r}` on every
 * blank row down to FORMULA_PREFILLED_THROUGH_ROW, and the Overview/Wish-List
 * SUMIFs read that column. We fill rows in place rather than appending so the
 * formula is already there.
 */
export const OrderColumn = Object.freeze({
  CLASSIFICATION: 0,   // A
  WISH_ID: 1,          // B
  PART_NUMBER: 2,      // C
  VENDOR: 3,           // D
  DESCRIPTION: 4,      // E  <- scanned to find the last populated row
  QTY: 5,              // F
  PRICE: 6,            // G
  LINK: 7,             // H
  JIRA_KEY: 8,         // I
  TRACKING_NUMBER: 9,  // J
  SHIPPING_COST: 10,   // K
  RECEIPT_LINK: 11,    // L
  ORDER_STATUS: 12,    // M
  TOTAL: 13,           // N  <- formula, do not overwrite
  SOURCE: 14,          // O
});

/** Number of columns we read/write on the Orders tab (A..O). */
export const ORDER_COLUMN_COUNT = 15;

/**
 * The Total formula is pre-filled through this row. Past it we must write the
 * formula ourselves or the row is invisible to every budget total in the doc.
 */
export const FORMULA_PREFILLED_THROUGH_ROW = 486;

/** Builds the Total formula for a 1-based sheet row. */
export function totalFormulaForRow(row) {
  return `=(F${row}*G${row})+K${row}`;
}

/**
 * Classification values (Options!A2:A7). Drives every budget number in the
 * doc via `SUMIF(Orders!A:A, <classification>, Orders!N:N)`.
 */
export const Classification = Object.freeze({
  ROBOT: 'Robot',
  TOOLING: 'Tooling',
  BUSINESS: 'Business',
  VFF: 'VFF',
  VOUCHER: 'Voucher',
  GAME: 'Game',
});

export const CLASSIFICATIONS = Object.values(Classification);

/** Default applied to newly submitted rows; by far the dominant value. */
export const DEFAULT_CLASSIFICATION = Classification.ROBOT;

/**
 * Order Status values (Options!B2:B5). Note there is no "Submitted" value —
 * a row handed to the purchaser but not yet ordered leaves this blank.
 */
export const OrderStatus = Object.freeze({
  ORDERED: 'Ordered',
  OUT_OF_STOCK: 'Out-of-stock',
  DELIVERED: 'Delivered',
  NEEDS_ATTENTION: 'Needs Attention',
});

export const ORDER_STATUSES = Object.values(OrderStatus);

/**
 * How far along the pipeline each side's state sits. Sync only ever moves a
 * ticket *forward*, so these ranks are what gets compared.
 *
 * A blank Order Status is stage 0: the row has been handed to the purchaser
 * but not yet ordered. Out-of-stock and Needs Attention are deliberately
 * absent — they are not points on the pipeline, so they are surfaced for a
 * human rather than acted on.
 */
export const SHEET_STAGE = Object.freeze({
  '': 0,
  [OrderStatus.ORDERED]: 1,
  [OrderStatus.DELIVERED]: 2,
});

export const JIRA_STAGE = Object.freeze({
  [PartStatus.SENT_TO_VFF]: 0,
  [PartStatus.ORDERED]: 1,
  [PartStatus.DELIVERED]: 2,
});

/** Sheet statuses that mean "a human needs to look at this". */
export const ATTENTION_STATUSES = Object.freeze([
  OrderStatus.OUT_OF_STOCK,
  OrderStatus.NEEDS_ATTENTION,
]);

/**
 * The transition to run to climb one stage. Index is the stage being left.
 * Jira has no direct Sent to VFF -> Delivered edge, so a two-stage jump runs
 * both in sequence.
 */
export const STAGE_TRANSITIONS = Object.freeze([
  PartTransition.ORDERED,    // stage 0 -> 1
  PartTransition.DELIVERED,  // stage 1 -> 2
]);

/**
 * Funding source (Orders col O). Chosen per vendor, since a vendor order is a
 * single purchase drawn from a single pot of money. May also be left blank —
 * the sheet's own validation allows an empty cell.
 */
export const Source = Object.freeze({
  LISD: 'LISD',
  VFF: 'VFF',
});

export const SOURCES = Object.values(Source);

/**
 * Default for a new vendor group: nothing recorded. Left blank rather than
 * guessing LISD, so the funding source is always a deliberate choice.
 */
export const DEFAULT_SOURCE = '';

/**
 * True when a value is an acceptable Source cell: one of the listed options,
 * or blank for "no funding source recorded".
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isValidSource(value) {
  if (value === null || value === undefined || value === '') return true;
  return SOURCES.includes(value);
}

// ---------------------------------------------------------------------------
// Sheet tab names
// ---------------------------------------------------------------------------

export const SheetTab = Object.freeze({
  ORDERS: process.env.ORDER_SHEET_TAB ?? 'Orders',
  OVERVIEW: 'Overview',
  WISH_LIST: 'Wish-List',
  OPTIONS: 'Options',
});

/**
 * Overview rows (1-based) that carry per-classification budget figures, as
 * `A{row}` = classification name, `B` = Budget, `C` = Spent, `D` = Remaining.
 * Row 2 is the "Total" roll-up.
 */
export const OVERVIEW_TOTAL_ROW = 2;
export const OVERVIEW_CATEGORY_ROWS = Object.freeze([3, 4, 5, 6, 7]);

/**
 * The per-vendor voucher block on Overview starts on the row after the one
 * whose column A matches this, and runs until column A goes blank. Located by
 * its heading rather than a fixed row number so adding a voucher vendor to the
 * sheet does not need a code change.
 *
 * Those rows track voucher spend with
 *   SUMIFS(Orders!N:N, Orders!A:A, "Voucher", Orders!D:D, <vendor label>)
 * — an exact match on the Vendor column, which is why canonical vendor names
 * have to agree with these labels. See utils/vendorNormalize.js.
 */
export const OVERVIEW_VOUCHER_HEADING = /^voucher codes/i;
