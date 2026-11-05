/**
 * File Jobs — attaching a Part's picture, DXFs and drawings takes seconds
 * per Part, so the cut does not wait for it. It queues a job per Part and
 * answers; the jobs run here, a few at a time, in the background.
 *
 * Parts are found in the cut version's BOM (`versionLink`), so the files
 * match what was cut and every read of that version can be kept.
 *
 * A 3D print's STEP is left out of its job and gathered: once the queue has
 * drained, one export per Part Studio covers all its 3D prints (OnShape
 * sends each as its own file), so the Parts' state stays `pending` until
 * their STEP is on.
 *
 * The queue lives in memory. A job lost to a restart or a failure shows on
 * the Assembly page as Parts missing files, and its "Make missing files"
 * queues just those again (BuildService.queueMissingFiles).
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
    /** studio key -> { studio, parts: [{ key, partNumber, partId, name }] }, waiting for the queue to drain */
    this._stepBatches = new Map();
    this._stepsRunning = 0;
  }

  /**
   * Queue a Part's files. Does nothing for a Part already queued, running,
   * or finished a moment ago.
   *
   * @param {object} job
   * @param {string} job.key           The Part's ticket
   * @param {string} job.partNumber    "VR27P-1103A"
   * @param {string} [job.thickness]   The Part's Thickness (set: one DXF; None: three)
   * @param {string} [job.material]    The Part's Material, for its drawing
   * @param {string} [job.machinery]   A 3D print gets no Thickness
   * @param {string} [job.tapping]     The Part's Needs Tapping?, for its drawing
   * @param {object} [job.origin]      Where the part lives in OnShape, if known
   * @param {string} [job.assemblyKey] The Assembly to find it in, when `origin` is not known
   * @param {string} [job.versionLink] The cut version to find it in (else the Assembly's workspace)
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

  /** Resolves once nothing is queued, running or exporting. */
  idle() {
    if (this._queue.length === 0 && this._running === 0 && this._stepsRunning === 0 && this._stepBatches.size === 0) {
      return Promise.resolve();
    }
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
          this._flushSteps();
          this._settle();
        }
      });
    }
  }

  async _run(job) {
    const finish = (state, problems = []) => this._state.set(job.key, { state, problems, at: Date.now() });
    try {
      const found = job.origin ? { origin: job.origin, name: job.name, color: job.color } : await this._partOf(job);
      const origin = found?.origin;
      if (!origin) {
        finish('failed', [`couldn't find ${job.partNumber} in OnShape`]);
        return;
      }
      const { problems, needsStep } = await this.partFiles.attach({
        step: 'later',
        color: found.color ?? null,
        key: job.key,
        partNumber: job.partNumber,
        origin,
        thickness: job.thickness,
        material: job.material,
        machinery: job.machinery,
        tapping: job.tapping,
      });
      if (needsStep) {
        // Still pending: its STEP comes with its Part Studio's others.
        this._state.set(job.key, { state: 'pending', problems, at: Date.now() });
        this._addStep(origin, { key: job.key, partNumber: job.partNumber, partId: origin.partId, name: found.name });
        return;
      }
      finish(problems.length ? 'failed' : 'done', problems);
    } catch (err) {
      console.warn('[files]', job.key, 'failed:', err?.status, err?.message);
      finish('failed', [describeUpstreamError(err)]);
    }
  }

  /** The part in the Assembly's BOM (the cut version's, when known) with this number; the letter doesn't matter. */
  async _partOf({ assemblyKey, partNumber, versionLink }) {
    if (!this.onshapeWriter || !assemblyKey) return null;
    const { parts } = await this.onshapeWriter.readBom(assemblyKey, { versionLink });
    const wanted = baseNumber({ fullPartNumber: partNumber });
    const part = parts.find((p) => p.origin && baseNumber(p) === wanted);
    return part ? { origin: part.origin, name: part.name, color: part.color ?? null } : null;
  }

  /** Hold a 3D print for its Part Studio's STEP export. */
  _addStep(origin, part) {
    const { partId, microversionId, ...studio } = origin;
    const key = [studio.documentId, studio.wvmType, studio.wvmId, studio.elementId, studio.configuration ?? ''].join(':');
    if (!this._stepBatches.has(key)) this._stepBatches.set(key, { studio, parts: [] });
    this._stepBatches.get(key).parts.push(part);
  }

  /** Start one STEP export per Part Studio for the 3D prints gathered, in the background. */
  _flushSteps() {
    const batches = [...this._stepBatches.values()];
    this._stepBatches.clear();
    for (const { studio, parts } of batches) {
      this._stepsRunning += 1;
      this.partFiles.attachSteps(studio, parts)
        .then((results) => {
          for (const part of parts) {
            const before = this._state.get(part.key)?.problems ?? [];
            const problems = [...before, ...(results.get(part.key)?.problems ?? [])];
            this._state.set(part.key, { state: problems.length ? 'failed' : 'done', problems, at: Date.now() });
          }
        })
        .catch((err) => {
          for (const part of parts) {
            this._state.set(part.key, { state: 'failed', problems: [describeUpstreamError(err)], at: Date.now() });
          }
        })
        .finally(() => {
          this._stepsRunning -= 1;
          this._settle();
        });
    }
  }

  /** Wake `idle()` callers once nothing is queued, running or exporting. */
  _settle() {
    if (this._queue.length === 0 && this._running === 0 && this._stepsRunning === 0 && this._stepBatches.size === 0) {
      for (const resolve of this._idle.splice(0)) resolve();
    }
  }

  _prune() {
    const cutoff = Date.now() - KEEP_MS;
    for (const [key, entry] of this._state) {
      if (entry.state !== 'pending' && entry.at < cutoff) this._state.delete(key);
    }
  }
}
