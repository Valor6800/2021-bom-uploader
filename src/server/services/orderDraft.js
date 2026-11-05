/**
 * The order being put together on the Parts Order page, shared between mentors:
 * for each ticket in the queue, whether it is ticked and its Classification and
 * Wish-List bucket. Nothing in Jira or the sheet carries these until the order
 * is submitted, so they are kept here, in `data/purchasing-draft.json`.
 *
 * Each ticket holds only the fields someone has actually set, and a save changes
 * only the fields it names, so two mentors working on different rows (or on
 * different fields of one row) cannot overwrite each other.
 *
 * Assumes one server process: writes are queued here, not locked on disk.
 *
 * Saving rejects, since the mentor must be told their change was not kept.
 * Everything else never rejects: a damaged file or a failed clean-up must not
 * stop the queue loading or fail an order that has already been written.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { badRequest } from '../middleware/httpError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(__dirname, '../../../data/purchasing-draft.json');

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_ROWS = 1000;
const MAX_CLASSIFICATION_LENGTH = 100;

/**
 * Check one row of a save. Only its shape: whether a Classification or bucket
 * still exists is checked against the sheet at submit, as it would be too slow
 * to read the sheet on every click.
 *
 * @returns {{ key: string, fields: object }}
 */
function parseRow(row) {
  const key = row?.key;
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw badRequest('Every row needs a valid ticket key');
  }

  const fields = {};

  if (row.selected !== undefined) {
    if (typeof row.selected !== 'boolean') throw badRequest(`${key}: selected must be true or false`);
    fields.selected = row.selected;
  }

  if (row.classification !== undefined) {
    const { classification } = row;
    if (
      typeof classification !== 'string'
      || !classification
      || classification.length > MAX_CLASSIFICATION_LENGTH
    ) {
      throw badRequest(`${key}: invalid classification`);
    }
    fields.classification = classification;
  }

  if (row.wishId !== undefined) {
    // Wish ID 0 is a real bucket; null means no bucket.
    if (row.wishId !== null && !Number.isFinite(row.wishId)) {
      throw badRequest(`${key}: wishId must be a number or null`);
    }
    fields.wishId = row.wishId;
  }

  return { key, fields };
}

export class OrderDraft {
  /** @param {{ file?: string }} [options] */
  constructor({ file = DEFAULT_FILE } = {}) {
    this.file = file;
    /** @type {Map<string, object>|null} Loaded on first use. */
    this._rows = null;
    this._tail = Promise.resolve();
  }

  /**
   * Every saved row.
   * @returns {Promise<Record<string, { selected?: boolean, classification?: string, wishId?: number|null }>>}
   */
  read() {
    return this._inTurn(async () => Object.fromEntries(await this._load()));
  }

  /**
   * Save changes to some rows.
   *
   * @param {{ key: string, selected?: boolean, classification?: string, wishId?: number|null }[]} rows
   * @returns {Promise<void>}  Rejects if a row is invalid or the file can't be written
   */
  async update(rows) {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
      throw badRequest(`rows must be an array of 1 to ${MAX_ROWS} rows`);
    }
    const parsed = rows.map(parseRow);

    await this._inTurn(async () => {
      const next = new Map(await this._load());
      for (const { key, fields } of parsed) {
        next.set(key, { ...next.get(key), ...fields });
      }
      await this._commit(next);
    });
  }

  /**
   * Forget tickets that have left the queue, so one that comes back later does
   * not return already ticked.
   *
   * @param {string[]} keys  The tickets in the queue now
   * @returns {Promise<object>}  The rows left, as read() returns them
   */
  retain(keys) {
    const keep = new Set(keys);
    return this._prune((key) => keep.has(key));
  }

  /**
   * Forget tickets that have just been submitted.
   * @param {string[]} keys
   * @returns {Promise<object>}  The rows left, as read() returns them
   */
  remove(keys) {
    const drop = new Set(keys);
    return this._prune((key) => !drop.has(key));
  }

  /** @private */
  _prune(shouldKeep) {
    return this._inTurn(async () => {
      const rows = await this._load();
      const next = new Map([...rows].filter(([key]) => shouldKeep(key)));

      if (next.size !== rows.size) {
        await this._commit(next).catch((err) => {
          console.warn('[order-draft] could not clean up the saved order:', err.message);
        });
      }

      return Object.fromEntries(this._rows);
    });
  }

  /** Run `task` after every earlier one has finished. @private */
  _inTurn(task) {
    const run = this._tail.then(task);
    this._tail = run.catch(() => {});
    return run;
  }

  /** @private */
  async _load() {
    if (this._rows) return this._rows;

    try {
      const { rows } = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this._rows = new Map(Object.entries(rows ?? {}));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[order-draft] could not read the saved order, starting empty:', err.message);
      }
      this._rows = new Map();
    }

    return this._rows;
  }

  /** Written whole, then swapped in, so a crash can't leave half a file. @private */
  async _commit(next) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ rows: Object.fromEntries(next) }, null, 2));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    this._rows = next;
  }
}
