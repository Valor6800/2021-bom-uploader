/**
 * File Jobs — attaching a Part's picture, STEP and DXFs takes seconds per
 * Part, so Save does not wait for it. It queues a job per Part made and
 * answers; the jobs run here, a few at a time, in the background.
 *
 * The queue lives in memory. A job lost to a restart or a failure is made up
 * on the next Update from CAD, which queues any Part still missing files
 * (see PartService), so a gap never lasts.
 */

import { baseNumber } from '../utils/partChain.js';
import { describeUpstreamError } from '../utils/upstreamError.js';

/** How long a finished job is remembered for the Designer to ask about. */
const KEEP_MS = 30 * 60 * 1000;
/** A Part whose files just went on is not queued again for this long. */
const RECENT_DONE_MS = 5 * 60 * 1000;

export class FileJobs {
  /**
   * @param {object} deps
   * @param {import('./partFiles.js').PartFiles} deps.partFiles
   * @param {import('./onshapeWriter.js').OnshapeWriter} [deps.onshapeWriter]  Finds a part in the Assembly's BOM when the job has no location
   * @param {number} [deps.concurrency]  Parts worked on at once
   */
  constructor({ partFiles, onshapeWriter, concurrency = 4 }) {
    this.partFiles = partFiles;
    this.onshapeWriter = onshapeWriter;
    this.concurrency = concurrency;
    /** ticket key -> { state: 'pending'|'done'|'failed', problems: string[], at: number } */
    this._state = new Map();
    this._queue = [];
    this._running = 0;
    this._idle = [];
  }

  /**
   * Queue a Part's files. Does nothing for a Part already queued, running,
   * or finished a moment ago.
   *
   * @param {object} job
   * @param {string} job.key           The Part's ticket
   * @param {string} job.partNumber    "VR27P-1103A"
   * @param {string} [job.thickness]   The Part's Thickness (set: one DXF; None: three)
   * @param {object} [job.origin]      Where the part lives in OnShape, if known
   * @param {string} [job.assemblyKey] The Assembly to find it in, when `origin` is not known
   * @returns {boolean} True when it was queued
   */
  enqueue(job) {
    this._prune();
    const current = this._state.get(job.key);
    if (current?.state === 'pending') return false;
    if (current?.state === 'done' && Date.now() - current.at < RECENT_DONE_MS) return false;
    this._state.set(job.key, { state: 'pending', problems: [], at: Date.now() });
    this._queue.push(job);
    this._pump();
    return true;
  }

  /**
   * Where each ticket's job stands. A ticket this server knows nothing about
   * (after a restart) is left out.
   *
   * @param {string[]} keys
   * @returns {Record<string, { state: string, problems: string[] }>}
   */
  status(keys) {
    const out = {};
    for (const key of keys) {
      const entry = this._state.get(key);
      if (entry) out[key] = { state: entry.state, problems: entry.problems };
    }
    return out;
  }

  /** Resolves once nothing is queued or running. */
  idle() {
    if (this._queue.length === 0 && this._running === 0) return Promise.resolve();
    return new Promise((resolve) => { this._idle.push(resolve); });
  }

  _pump() {
    while (this._running < this.concurrency && this._queue.length > 0) {
      const job = this._queue.shift();
      this._running += 1;
      this._run(job).finally(() => {
        this._running -= 1;
        this._pump();
        if (this._queue.length === 0 && this._running === 0) {
          for (const resolve of this._idle.splice(0)) resolve();
        }
      });
    }
  }

  async _run(job) {
    const finish = (state, problems = []) => this._state.set(job.key, { state, problems, at: Date.now() });
    try {
      const origin = job.origin ?? await this._originOf(job);
      if (!origin) {
        finish('failed', [`couldn't find ${job.partNumber} in OnShape`]);
        return;
      }
      const { problems } = await this.partFiles.attach({
        key: job.key, partNumber: job.partNumber, origin, thickness: job.thickness,
      });
      finish(problems.length ? 'failed' : 'done', problems);
    } catch (err) {
      console.warn('[files]', job.key, 'failed:', err?.status, err?.message);
      finish('failed', [describeUpstreamError(err)]);
    }
  }

  /** The part in the Assembly's BOM with this number (the letter doesn't matter). */
  async _originOf({ assemblyKey, partNumber }) {
    if (!this.onshapeWriter || !assemblyKey) return null;
    const { parts } = await this.onshapeWriter.readBom(assemblyKey);
    const wanted = baseNumber({ fullPartNumber: partNumber });
    return parts.find((p) => p.origin && baseNumber(p) === wanted)?.origin ?? null;
  }

  _prune() {
    const cutoff = Date.now() - KEEP_MS;
    for (const [key, entry] of this._state) {
      if (entry.state !== 'pending' && entry.at < cutoff) this._state.delete(key);
    }
  }
}
