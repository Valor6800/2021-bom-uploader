/**
 * OnShape answers for a cut version, kept on disk. A version never changes,
 * so its BOM read once is good for ever: kept here, a server restart (or a
 * deploy) doesn't spend the call again. One JSON file per answer, named by a
 * hash of its key, in `data/onshape-versions/` (or `ONSHAPE_CACHE_DIR`).
 *
 * Never throws: a store that can't be read or written (a read-only disk, a
 * damaged file) only means the answer is asked of OnShape again.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, '../../../data/onshape-versions');
/** At most this many answers are kept; the least recently used go first. */
const MAX_FILES = 500;

export class VersionStore {
  /**
   * @param {{ dir?: string, maxFiles?: number }} [options]
   */
  constructor({ dir = process.env.ONSHAPE_CACHE_DIR || DEFAULT_DIR, maxFiles = MAX_FILES } = {}) {
    this.dir = dir;
    this.maxFiles = maxFiles;
    this._warned = false;
  }

  _file(key) {
    return path.join(this.dir, `${crypto.createHash('sha256').update(String(key)).digest('hex')}.json`);
  }

  /** The kept answer for `key`, or null. */
  async get(key) {
    const file = this._file(key);
    try {
      const { key: stored, value } = JSON.parse(await fs.readFile(file, 'utf8'));
      if (stored !== key) return null;
      // Touched, so the ones in use are the last to be let go.
      const now = new Date();
      fs.utimes(file, now, now).catch(() => {});
      return value;
    } catch {
      return null;
    }
  }

  /** Keep `value` for `key` (written whole, so a reader never sees half a file). */
  async set(key, value) {
    const file = this._file(key);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ key, value }));
      await fs.rename(tmp, file);
      await this._trim();
    } catch (err) {
      fs.rm(tmp, { force: true }).catch(() => {});
      if (!this._warned) {
        this._warned = true;
        console.warn('[version-store] could not keep a version on disk:', err.message);
      }
    }
  }

  /** Let the least recently used go past `maxFiles`. @private */
  async _trim() {
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.json'));
    if (names.length <= this.maxFiles) return;
    const dated = await Promise.all(names.map(async (n) => {
      const stat = await fs.stat(path.join(this.dir, n)).catch(() => null);
      return { n, at: stat?.mtimeMs ?? 0 };
    }));
    dated.sort((a, b) => a.at - b.at);
    await Promise.all(dated.slice(0, names.length - this.maxFiles).map(({ n }) => fs.rm(path.join(this.dir, n), { force: true })));
  }
}
