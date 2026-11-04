/**
 * Google Sheets Client — thin wrapper around google-spreadsheet v4.
 *
 * Provides service-account auth, cached document loading, raw-cell access, and
 * exponential-backoff retry on rate limiting. Deliberately low-level: it knows
 * about cells and tabs, not about orders or budgets. Order Sheet Service owns
 * the domain layout.
 */

import fs from 'node:fs';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

export class SheetsApiError extends Error {
  /**
   * @param {string} message   Human-readable description
   * @param {number} status    HTTP status code (0 when unknown)
   * @param {string} operation The operation that failed
   */
  constructor(message, status, operation) {
    super(message);
    this.name = 'SheetsApiError';
    this.status = status;
    this.operation = operation;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractStatus(err) {
  return err?.response?.status ?? err?.status ?? err?.code ?? 0;
}

/** Google returns 429 for quota exhaustion; 5xx for transient server faults. */
function isTransient(err) {
  const status = Number(extractStatus(err));
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return typeof err?.message === 'string' && err.message.includes('429');
}

function wrapError(err, operation) {
  const status = Number(extractStatus(err)) || 0;
  return new SheetsApiError(err?.message ?? String(err), status, operation);
}

// ---------------------------------------------------------------------------
// SheetsClient
// ---------------------------------------------------------------------------

export class SheetsClient {
  /**
   * @param {object} [options]
   * @param {string} [options.spreadsheetId]    Defaults to ORDER_SHEET_ID env
   * @param {string} [options.credentialsPath]  Defaults to GOOGLE_CREDENTIALS_PATH env
   * @param {object} [options.credentials]      Pre-parsed service-account JSON (tests)
   */
  constructor(options = {}) {
    const spreadsheetId = options.spreadsheetId ?? process.env.ORDER_SHEET_ID;
    const credentialsPath =
      options.credentialsPath ?? process.env.GOOGLE_CREDENTIALS_PATH ?? './keys.json';

    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID is required (set ORDER_SHEET_ID env var)');
    }

    this.spreadsheetId = spreadsheetId;
    this.credentialsPath = credentialsPath;
    this.credentials = options.credentials ?? null;
    this.doc = null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Authenticate and load spreadsheet metadata. Idempotent — repeat calls
   * reuse the loaded document.
   *
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.doc) return;

    const credentials = this.credentials ?? this._readCredentials();

    const auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES,
    });

    const doc = new GoogleSpreadsheet(this.spreadsheetId, auth);
    await this._retry(() => doc.loadInfo(), 'loadInfo');
    this.doc = doc;
  }

  /** @returns {Promise<string>} The spreadsheet's title. */
  async title() {
    await this.connect();
    return this.doc.title;
  }

  /** @returns {Promise<string|null>} The spreadsheet's time zone, e.g. "America/Chicago". */
  async timeZone() {
    await this.connect();
    return this.doc.timeZone ?? null;
  }

  /**
   * Fetch a tab by title.
   *
   * @param {string} tabTitle
   * @returns {Promise<object>} google-spreadsheet worksheet
   */
  async getTab(tabTitle) {
    await this.connect();

    const sheet = this.doc.sheetsByTitle[tabTitle];
    if (!sheet) {
      const available = Object.keys(this.doc.sheetsByTitle).join(', ');
      throw new SheetsApiError(
        `Tab "${tabTitle}" not found in spreadsheet. Available tabs: ${available}`,
        404,
        'getTab',
      );
    }

    return sheet;
  }

  /**
   * Load a rectangular cell range into memory so `cell.value` works.
   *
   * @param {string} tabTitle
   * @param {object} range
   * @param {number} range.startRow     0-based, inclusive
   * @param {number} range.endRow       0-based, exclusive
   * @param {number} range.startColumn  0-based, inclusive
   * @param {number} range.endColumn    0-based, exclusive
   * @returns {Promise<object>} The loaded worksheet
   */
  async loadRange(tabTitle, { startRow, endRow, startColumn, endColumn }) {
    const sheet = await this.getTab(tabTitle);

    await this._retry(
      () => sheet.loadCells({
        startRowIndex: startRow,
        endRowIndex: Math.min(endRow, sheet.rowCount),
        startColumnIndex: startColumn,
        endColumnIndex: Math.min(endColumn, sheet.columnCount),
      }),
      `loadCells(${tabTitle})`,
    );

    return sheet;
  }

  /**
   * Read a loaded range as a 2D array of raw cell values.
   *
   * @param {string} tabTitle
   * @param {object} range  Same shape as loadRange
   * @returns {Promise<{ rows: *[][], sheet: object }>} `rows[0]` is `startRow`
   */
  async readRange(tabTitle, range) {
    const sheet = await this.loadRange(tabTitle, range);
    const lastRow = Math.min(range.endRow, sheet.rowCount);
    const lastColumn = Math.min(range.endColumn, sheet.columnCount);

    const rows = [];
    for (let r = range.startRow; r < lastRow; r++) {
      const row = [];
      for (let c = range.startColumn; c < lastColumn; c++) {
        row.push(sheet.getCell(r, c).value);
      }
      rows.push(row);
    }

    return { rows, sheet };
  }

  /**
   * Write individual cells and save in one batch.
   *
   * The caller is responsible for having loaded the affected range first
   * (writeCells does it for the bounding box of the given updates).
   *
   * @param {string} tabTitle
   * @param {{ row: number, column: number, value?: *, formula?: string,
   *   format?: { backgroundColor?: object, numberFormat?: object } }[]} updates
   *   `row`/`column` are 0-based. Pass `formula` to write a formula instead of
   *   a literal value. Pass `format` to set cell formatting; an update with
   *   only `format` leaves the cell's contents alone.
   * @returns {Promise<number>} Number of cells written
   */
  async writeCells(tabTitle, updates) {
    if (updates.length === 0) return 0;

    const rowsTouched = updates.map((u) => u.row);
    const colsTouched = updates.map((u) => u.column);

    const sheet = await this.loadRange(tabTitle, {
      startRow: Math.min(...rowsTouched),
      endRow: Math.max(...rowsTouched) + 1,
      startColumn: Math.min(...colsTouched),
      endColumn: Math.max(...colsTouched) + 1,
    });

    for (const update of updates) {
      const cell = sheet.getCell(update.row, update.column);
      if (update.formula !== undefined) {
        cell.formula = update.formula;
      } else if (update.value !== undefined) {
        cell.value = update.value;
      }

      for (const [param, setting] of Object.entries(update.format ?? {})) {
        cell[param] = setting;
      }
    }

    await this._retry(() => sheet.saveUpdatedCells(), `saveUpdatedCells(${tabTitle})`);
    return updates.length;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** @private */
  _readCredentials() {
    try {
      return JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
    } catch (err) {
      throw new SheetsApiError(
        `Could not read Google service-account credentials from "${this.credentialsPath}". `
        + `Set GOOGLE_CREDENTIALS_PATH to the service-account JSON file. (${err.message})`,
        0,
        'readCredentials',
      );
    }
  }

  /**
   * Execute `fn` with exponential-backoff retry for rate limits and 5xx.
   * Everything else surfaces immediately.
   * @private
   */
  async _retry(fn, operation) {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        if (!isTransient(err)) throw wrapError(err, operation);

        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        }
      }
    }

    throw wrapError(lastError, operation);
  }
}
