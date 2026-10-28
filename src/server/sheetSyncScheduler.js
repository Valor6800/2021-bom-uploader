/**
 * Background poll that pulls the purchaser's spreadsheet edits into Jira.
 *
 * Google Sheets has no outbound webhook, and the alternatives both have real
 * costs: Drive push notifications need a publicly reachable HTTPS endpoint
 * (and only report "something changed"), while an Apps Script trigger means a
 * second copy of the Jira credential living in Google. Polling keeps this
 * server private and the workflow logic in one testable place, at the cost of
 * latency measured in minutes — which is nothing against purchasing
 * timescales.
 *
 * Runs are serialized: a slow pass never overlaps the next tick.
 */

/** Default cadence. Purchasing does not move faster than this. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Floor, so a misconfigured value cannot hammer the Sheets or Jira APIs. */
const MIN_INTERVAL_MS = 30 * 1000;

export class SheetSyncScheduler {
  /**
   * @param {object} deps
   * @param {import('./services/receivingService.js').ReceivingService} deps.receivingService
   * @param {number} [deps.intervalMs]  0 disables the poll entirely
   * @param {Console} [deps.logger]
   */
  constructor({ receivingService, intervalMs, logger = console }) {
    this.receivingService = receivingService;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.lastRun = null;
    this.lastResult = null;
    this.lastError = null;

    // `??` only guards unset, and Number('') is 0 — which line below reads as
    // the deliberate "disabled" sentinel. A present-but-empty variable (easy
    // to produce in a .env or a compose `environment:` entry) would therefore
    // silently stop the purchaser's edits ever reaching Jira.
    const raw = process.env.SHEET_SYNC_INTERVAL_MS;
    const fromEnv = raw === undefined || String(raw).trim() === ''
      ? DEFAULT_INTERVAL_MS
      : Number(raw);

    const configured = intervalMs ?? fromEnv;

    this.intervalMs = configured === 0
      ? 0
      : Math.max(Number.isFinite(configured) ? configured : DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
  }

  /** @returns {boolean} Whether polling is switched on. */
  get enabled() {
    return this.intervalMs > 0;
  }

  /**
   * Begin polling. The first pass runs one interval from now rather than at
   * boot, so startup stays fast and a restart loop cannot spam the APIs.
   */
  start() {
    if (!this.enabled) {
      this.logger.log('Sheet sync disabled (SHEET_SYNC_INTERVAL_MS=0)');
      return;
    }

    if (this.timer) return;

    this.timer = setInterval(() => { this.runOnce(); }, this.intervalMs);
    this.logger.log(`Sheet sync polling every ${Math.round(this.intervalMs / 1000)}s`);
  }

  /** Stop polling. */
  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Run one reconciliation pass. Safe to call directly (tests, a manual
   * trigger); overlapping calls are skipped rather than queued.
   *
   * @returns {Promise<object|null>} The sync result, or null if skipped
   */
  async runOnce() {
    if (this.running) {
      this.logger.warn('Sheet sync still running from the last tick; skipping this one');
      return null;
    }

    this.running = true;

    try {
      const result = await this.receivingService.syncFromSheet();
      this.lastRun = new Date().toISOString();
      this.lastResult = result;
      this.lastError = null;

      if (result.advanced.length > 0) {
        for (const move of result.advanced) {
          this.logger.log(
            `Sheet sync: ${move.key} ${move.from} -> ${move.to} (sheet row ${move.row})`,
          );
        }
      }

      for (const failure of result.errors) {
        this.logger.error(`Sheet sync: ${failure.key} could not be advanced — ${failure.error}`);
      }

      return result;
    } catch (err) {
      this.lastError = { at: new Date().toISOString(), message: err.message };
      this.logger.error(`Sheet sync pass failed: ${err.message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Snapshot for a status endpoint. */
  status() {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      running: this.running,
      lastRun: this.lastRun,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }
}
