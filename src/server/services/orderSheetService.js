/**
 * Order Sheet Service — all domain knowledge about the FRC Parts Order
 * spreadsheet lives here.
 *
 * Two layout facts drive the write strategy:
 *
 *  1. The Orders tab pre-fills `=(F{r}*G{r})+K{r}` in the Total column on
 *     every blank row down to FORMULA_PREFILLED_THROUGH_ROW, and the Overview
 *     and Wish-List tabs read that column through SUMIF. So we fill existing
 *     rows in place and never append — an appended row lands past the
 *     pre-formulated block, its Total stays empty, and it silently counts
 *     toward no budget at all.
 *
 *  2. Classification (col A) is the key for every budget roll-up. A row with
 *     a blank Classification is invisible to the entire budget.
 *
 * Orders are separated by an order-date row: every cell filled black, and the
 * date the order was cut in Description (col E). It closes the order above
 * it, so the sheet reads as blocks of lines each followed by their date. It
 * is a divider, not a part, and is never returned from readOrders().
 */

import { badRequest } from '../middleware/httpError.js';
import {
  OrderColumn,
  ORDER_COLUMN_COUNT,
  FORMULA_PREFILLED_THROUGH_ROW,
  totalFormulaForRow,
  OrderStatus,
  SheetTab,
  OVERVIEW_TOTAL_ROW,
  OVERVIEW_CATEGORY_ROWS,
  OVERVIEW_VOUCHER_HEADING,
} from '../utils/purchasingConstants.js';
import {
  serialToIsoDate,
  isoDateToSerial,
  textToIsoDate,
  todayIsoDate,
} from '../utils/sheetDates.js';

/** Columns that indicate a row is in use. Total (N) is excluded because the
 *  sheet pre-fills its formula on otherwise-blank rows. */
const IN_USE_COLUMNS = [
  OrderColumn.CLASSIFICATION,
  OrderColumn.WISH_ID,
  OrderColumn.PART_NUMBER,
  OrderColumn.VENDOR,
  OrderColumn.DESCRIPTION,
  OrderColumn.QTY,
  OrderColumn.PRICE,
  OrderColumn.LINK,
  OrderColumn.JIRA_KEY,
  OrderColumn.TRACKING_NUMBER,
  OrderColumn.SHIPPING_COST,
  OrderColumn.RECEIPT_LINK,
  OrderColumn.ORDER_STATUS,
  OrderColumn.SOURCE,
];

/**
 * Columns that must be empty on an order-date row. Source (O) is left out
 * because some date rows carry a stray pre-filled formula there that
 * evaluates to 0; Total (N) is left out for the same reason as above.
 */
const DATE_ROW_EMPTY_COLUMNS = IN_USE_COLUMNS.filter(
  (column) => column !== OrderColumn.DESCRIPTION && column !== OrderColumn.SOURCE,
);

/** Serials for 2000-01-01 and 2100-01-01: anything outside is not an order date. */
const MIN_DATE_SERIAL = 36526;
const MAX_DATE_SERIAL = 73051;

/** The order-date row's look: black across A..O, date formatted as m/d/yyyy. */
const BLACK = { red: 0, green: 0, blue: 0 };
const DATE_ROW_FORMAT = Object.freeze({
  backgroundColor: BLACK,
  backgroundColorStyle: { rgbColor: BLACK },
});
const DATE_FORMAT = Object.freeze({ type: 'DATE', pattern: 'm/d/yyyy' });

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function toNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export class OrderSheetService {
  /**
   * @param {object} deps
   * @param {import('../clients/sheetsClient.js').SheetsClient} deps.sheetsClient
   */
  constructor({ sheetsClient }) {
    this.sheetsClient = sheetsClient;
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  /**
   * Read every in-use row on the Orders tab.
   *
   * @returns {Promise<{ row: number, classification: string|null, wishId: number|null,
   *   partNumber: string|null, vendor: string|null, description: string|null,
   *   qty: number|null, price: number|null, link: string|null, jiraKey: string|null,
   *   trackingNumber: string|null, shippingCost: number|null, receiptLink: string|null,
   *   orderStatus: string|null, total: number|null, source: string|null }[]>}
   *   `row` is 1-based.
   */
  async readOrders() {
    const rows = await this._readOrdersGrid();
    const orders = [];

    // Row index 0 is the header.
    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      if (!this._isRowInUse(values) || this._orderDateOf(values)) continue;
      orders.push(this._toOrder(values, i + 1));
    }

    return orders;
  }

  /**
   * Every order on the tab, as the blocks the order-date rows divide it into.
   *
   * An order is the run of lines above a date row. Lines below the last date
   * row have not been closed off yet, so they come back with `date: null`.
   * Newest first, which is how anyone looking back through orders reads them.
   *
   * @returns {Promise<{ date: string|null, dateRow: number|null,
   *   firstRow: number, lastRow: number, lines: object[] }[]>}
   *   `date` is `YYYY-MM-DD`; `lines` are shaped like readOrders() rows.
   */
  async readOrderHistory() {
    const rows = await this._readOrdersGrid();
    const orders = [];
    let lines = [];

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      if (!this._isRowInUse(values)) continue;

      const date = this._orderDateOf(values);
      if (!date) {
        lines.push(this._toOrder(values, i + 1));
        continue;
      }

      // Two date rows in a row would be an empty order; nothing to show.
      if (lines.length > 0) {
        orders.push({ date, dateRow: i + 1, firstRow: lines[0].row, lastRow: lines.at(-1).row, lines });
      }
      lines = [];
    }

    if (lines.length > 0) {
      orders.push({ date: null, dateRow: null, firstRow: lines[0].row, lastRow: lines.at(-1).row, lines });
    }

    return orders.reverse();
  }

  /**
   * Map Jira issue key -> sheet row number for every row that carries a key.
   *
   * @returns {Promise<Map<string, number>>}
   */
  async buildJiraKeyIndex() {
    const orders = await this.readOrders();
    const index = new Map();

    for (const order of orders) {
      if (order.jiraKey) index.set(order.jiraKey.toUpperCase(), order.row);
    }

    return index;
  }

  /**
   * The first row a new submission should write to.
   *
   * When the last thing on the tab is an order-date row, the previous order is
   * already closed off, so the new one starts directly beneath it. Otherwise
   * (lines written before date rows existed, or added by hand) `gap` blank
   * rows are left so the new order does not run into them.
   *
   * @param {object} [options]
   * @param {number} [options.gap=1]  Blank rows to leave after an unclosed order
   * @returns {Promise<number>} 1-based row number
   */
  async findNextWritableRow({ gap = 1 } = {}) {
    const rows = await this._readOrdersGrid();

    let lastInUse = 0;
    for (let i = 1; i < rows.length; i++) {
      if (this._isRowInUse(rows[i])) lastInUse = i + 1;
    }

    // Empty log: start directly under the header, no leading gap.
    if (lastInUse === 0) return 2;

    if (this._orderDateOf(rows[lastInUse - 1])) return lastInUse + 1;

    return lastInUse + 1 + gap;
  }

  // -----------------------------------------------------------------------
  // Writes
  // -----------------------------------------------------------------------

  /**
   * Write a batch of order lines into consecutive rows, followed by the
   * order-date row that closes the order off.
   *
   * Order Status (col M) is deliberately left blank: the sheet's dropdown has
   * no "Submitted" value, so blank means "handed to the purchaser, not yet
   * ordered". Total (col N) is left alone unless we have run past the
   * pre-formulated block, in which case the formula is written explicitly.
   *
   * @param {object} params
   * @param {{ jiraKey: string, classification: string, wishId: number|null,
   *   partNumber: string|null, vendor: string, description: string,
   *   qty: number, price: number, link: string|null, source: string }[]} params.lines
   *   `source` is per line because it is chosen per vendor, and a submission
   *   can span vendors drawing on different funding.
   * @param {number} [params.startRow]  Defaults to findNextWritableRow()
   * @param {string} [params.orderDate]  `YYYY-MM-DD`; defaults to today in the
   *   spreadsheet's time zone
   * @returns {Promise<{ startRow: number, endRow: number, dateRow: number,
   *   orderDate: string, assignments: { jiraKey: string, row: number }[] }>}
   *   `endRow` is the last order line; `dateRow` is the row after it.
   */
  async writeOrderRows({ lines, startRow, orderDate }) {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('writeOrderRows requires a non-empty lines array');
    }

    const firstRow = startRow ?? await this.findNextWritableRow();
    const sheet = await this.sheetsClient.getTab(SheetTab.ORDERS);
    const lastRow = firstRow + lines.length - 1;
    const dateRow = lastRow + 1;
    const date = orderDate ?? todayIsoDate(await this.sheetsClient.timeZone?.());

    if (dateRow > sheet.rowCount) {
      throw badRequest(
        `Submission needs rows ${firstRow}-${dateRow} (including the order-date row) but the "${SheetTab.ORDERS}" tab `
        + `only has ${sheet.rowCount} rows. Add rows to the sheet and retry.`,
      );
    }

    /**
     * Re-check the target rows immediately before writing.
     *
     * Rows are filled in place, not appended, so two coordinators submitting
     * at once would both resolve the same first blank row and the second batch
     * would overwrite the first — the earlier order vanishing from the budget
     * while its tickets had already moved to Sent to VFF. This does not make
     * the write atomic, but it closes the window from "whenever the page was
     * loaded" down to the moment of writing, and fails loudly instead of
     * destroying data.
     */
    const { rows: targetRows } = await this.sheetsClient.readRange(SheetTab.ORDERS, {
      startRow: firstRow - 1,
      endRow: dateRow,
      startColumn: 0,
      endColumn: ORDER_COLUMN_COUNT,
    });

    const occupied = targetRows
      .map((values, offset) => (this._isRowInUse(values) ? firstRow + offset : null))
      .filter((row) => row !== null);

    if (occupied.length > 0) {
      throw badRequest(
        `Sheet row${occupied.length === 1 ? '' : 's'} ${occupied.join(', ')} `
        + 'filled up while this submission was being prepared — someone else may have '
        + 'submitted at the same time. Nothing was written; reload and try again.',
      );
    }

    const updates = [];
    const assignments = [];

    lines.forEach((line, offset) => {
      const sheetRow = firstRow + offset;
      const rowIndex = sheetRow - 1; // 0-based for the cell API

      const cells = [
        [OrderColumn.CLASSIFICATION, line.classification],
        [OrderColumn.WISH_ID, line.wishId ?? ''],
        [OrderColumn.PART_NUMBER, line.partNumber ?? ''],
        [OrderColumn.VENDOR, line.vendor],
        [OrderColumn.DESCRIPTION, line.description],
        [OrderColumn.QTY, line.qty],
        [OrderColumn.PRICE, line.price],
        [OrderColumn.LINK, line.link ?? ''],
        [OrderColumn.JIRA_KEY, line.jiraKey],
        [OrderColumn.SOURCE, line.source ?? ''],
      ];

      for (const [column, value] of cells) {
        updates.push({ row: rowIndex, column, value });
      }

      // Past the pre-formulated block the Total formula has to come from us,
      // or the row contributes nothing to any budget roll-up.
      if (sheetRow > FORMULA_PREFILLED_THROUGH_ROW) {
        updates.push({
          row: rowIndex,
          column: OrderColumn.TOTAL,
          formula: totalFormulaForRow(sheetRow),
        });
      }

      assignments.push({ jiraKey: line.jiraKey, row: sheetRow });
    });

    // The order-date row: black across the whole width, date in Description.
    for (let column = 0; column < ORDER_COLUMN_COUNT; column++) {
      updates.push(column === OrderColumn.DESCRIPTION
        ? {
          row: dateRow - 1,
          column,
          value: isoDateToSerial(date),
          format: { ...DATE_ROW_FORMAT, numberFormat: DATE_FORMAT },
        }
        : { row: dateRow - 1, column, format: DATE_ROW_FORMAT });
    }

    await this.sheetsClient.writeCells(SheetTab.ORDERS, updates);

    return { startRow: firstRow, endRow: lastRow, dateRow, orderDate: date, assignments };
  }

  /**
   * Set Order Status to Delivered on the given rows.
   *
   * @param {number[]} rowNumbers  1-based row numbers
   * @returns {Promise<number>} Number of rows updated
   */
  async markRowsDelivered(rowNumbers) {
    if (rowNumbers.length === 0) return 0;

    const updates = rowNumbers.map((row) => ({
      row: row - 1,
      column: OrderColumn.ORDER_STATUS,
      value: OrderStatus.DELIVERED,
    }));

    await this.sheetsClient.writeCells(SheetTab.ORDERS, updates);
    return rowNumbers.length;
  }

  // -----------------------------------------------------------------------
  // Budget and Wish-List
  // -----------------------------------------------------------------------

  /**
   * Read per-classification budget figures from the Overview tab.
   *
   * Note: "VFF" is a valid Classification in the Orders dropdown but has no
   * Overview row, so spend classified VFF appears in no budget total. That is
   * the spreadsheet's behaviour, reproduced here rather than papered over.
   *
   * @returns {Promise<{ total: object|null, categories: object[] }>}
   */
  async readBudget() {
    const sheet = await this.sheetsClient.getTab(SheetTab.OVERVIEW);
    const { rows } = await this.sheetsClient.readRange(SheetTab.OVERVIEW, {
      startRow: 0,
      endRow: sheet.rowCount,
      startColumn: 0,
      endColumn: 4, // A..D
    });

    const readRow = (sheetRow) => {
      const values = rows[sheetRow - 1];
      if (!values || isBlank(values[0])) return null;
      return {
        classification: String(values[0]).trim(),
        budget: toNumberOrNull(values[1]),
        spent: toNumberOrNull(values[2]),
        remaining: toNumberOrNull(values[3]),
      };
    };

    return {
      total: readRow(OVERVIEW_TOTAL_ROW),
      categories: OVERVIEW_CATEGORY_ROWS.map(readRow).filter(Boolean),
      vouchers: this._readVoucherRows(rows),
    };
  }

  /**
   * Per-vendor voucher allocations, located by the block heading in column A
   * and read until column A goes blank.
   *
   * `vendor` is the exact label the Overview SUMIFS matches against the Orders
   * Vendor column, so it is what a Voucher-classified row must be written as.
   *
   * @param {*[][]} rows  Overview A..D, row-index 0 = sheet row 1
   * @returns {{ vendor: string, budget: number|null, spent: number|null, remaining: number|null }[]}
   * @private
   */
  _readVoucherRows(rows) {
    const headingIndex = rows.findIndex(
      (values) => !isBlank(values?.[0]) && OVERVIEW_VOUCHER_HEADING.test(String(values[0]).trim()),
    );
    if (headingIndex === -1) return [];

    const vouchers = [];

    for (let i = headingIndex + 1; i < rows.length; i++) {
      const values = rows[i];
      if (!values || isBlank(values[0])) break;

      vouchers.push({
        vendor: String(values[0]).trim(),
        budget: toNumberOrNull(values[1]),
        spent: toNumberOrNull(values[2]),
        remaining: toNumberOrNull(values[3]),
      });
    }

    return vouchers;
  }

  /**
   * Read the Wish-List budget buckets.
   *
   * Only buckets with both an ID and an item name are returned — the tab
   * carries empty numbered placeholders past the real entries. Wish ID 0 is a
   * real bucket, so emptiness is tested explicitly rather than by truthiness.
   *
   * @returns {Promise<{ wishId: number, item: string, allocated: number|null,
   *   reserved: number|null, spent: number|null, remaining: number|null,
   *   notes: string|null }[]>}
   */
  async readWishList() {
    const sheet = await this.sheetsClient.getTab(SheetTab.WISH_LIST);
    const { rows } = await this.sheetsClient.readRange(SheetTab.WISH_LIST, {
      startRow: 0,
      endRow: sheet.rowCount,
      startColumn: 0,
      endColumn: 9, // A..I
    });

    const buckets = [];

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      const wishId = toNumberOrNull(values[0]);
      const item = isBlank(values[1]) ? null : String(values[1]).trim();

      if (wishId === null || !item) continue;

      buckets.push({
        wishId,
        item,
        allocated: toNumberOrNull(values[2]),
        reserved: toNumberOrNull(values[3]),
        spent: toNumberOrNull(values[4]),
        remaining: toNumberOrNull(values[5]),
        notes: isBlank(values[8]) ? null : String(values[8]).trim(),
      });
    }

    return buckets;
  }

  /**
   * Read the dropdown option lists the Orders tab validates against, so the
   * UI offers exactly what the sheet accepts.
   *
   * @returns {Promise<{ classifications: string[], orderStatuses: string[] }>}
   */
  async readOptions() {
    const sheet = await this.sheetsClient.getTab(SheetTab.OPTIONS);
    const { rows } = await this.sheetsClient.readRange(SheetTab.OPTIONS, {
      startRow: 0,
      endRow: Math.min(sheet.rowCount, 50),
      startColumn: 0,
      endColumn: 2, // A..B
    });

    const column = (index) => rows
      .slice(1)
      .map((r) => r[index])
      .filter((v) => !isBlank(v))
      .map((v) => String(v).trim());

    return {
      classifications: column(0),
      orderStatuses: column(1),
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** @private */
  _isRowInUse(values) {
    return IN_USE_COLUMNS.some((column) => !isBlank(values[column]));
  }

  /**
   * The order date on an order-date row, or null for any other row.
   *
   * Recognized by its contents rather than its black fill — formatting is not
   * read back — so a row counts when Description holds a date (a date serial,
   * or `m/d/yyyy` typed as text) and nothing else that describes a part is set.
   *
   * @returns {string|null} `YYYY-MM-DD`
   * @private
   */
  _orderDateOf(values) {
    if (!values || DATE_ROW_EMPTY_COLUMNS.some((column) => !isBlank(values[column]))) return null;

    const description = values[OrderColumn.DESCRIPTION];
    if (Number.isFinite(description)) {
      return description >= MIN_DATE_SERIAL && description < MAX_DATE_SERIAL
        ? serialToIsoDate(description)
        : null;
    }
    return textToIsoDate(description);
  }

  /** The whole Orders tab, A..O, row index 0 = header. @private */
  async _readOrdersGrid() {
    const sheet = await this.sheetsClient.getTab(SheetTab.ORDERS);
    const { rows } = await this.sheetsClient.readRange(SheetTab.ORDERS, {
      startRow: 0,
      endRow: sheet.rowCount,
      startColumn: 0,
      endColumn: ORDER_COLUMN_COUNT,
    });
    return rows;
  }

  /** @private */
  _toOrder(values, row) {
    const text = (column) => (isBlank(values[column]) ? null : String(values[column]));

    return {
      row,
      classification: text(OrderColumn.CLASSIFICATION),
      wishId: toNumberOrNull(values[OrderColumn.WISH_ID]),
      partNumber: text(OrderColumn.PART_NUMBER),
      vendor: text(OrderColumn.VENDOR),
      description: text(OrderColumn.DESCRIPTION),
      qty: toNumberOrNull(values[OrderColumn.QTY]),
      price: toNumberOrNull(values[OrderColumn.PRICE]),
      link: text(OrderColumn.LINK),
      jiraKey: text(OrderColumn.JIRA_KEY)?.trim() || null,
      trackingNumber: text(OrderColumn.TRACKING_NUMBER),
      shippingCost: toNumberOrNull(values[OrderColumn.SHIPPING_COST]),
      receiptLink: text(OrderColumn.RECEIPT_LINK),
      orderStatus: text(OrderColumn.ORDER_STATUS),
      total: toNumberOrNull(values[OrderColumn.TOTAL]),
      source: text(OrderColumn.SOURCE),
    };
  }
}
