import { jest } from '@jest/globals';
import { SheetSyncScheduler } from '../../src/server/sheetSyncScheduler.js';

const silentLogger = { log() {}, warn() {}, error() {} };

function emptyResult() {
  return { advanced: [], errors: [], skipped: { attention: 0, drift: 0, unmatched: 0 } };
}

describe('SheetSyncScheduler configuration', () => {
  it('disables polling when the interval is 0', () => {
    const scheduler = new SheetSyncScheduler({
      receivingService: {}, intervalMs: 0, logger: silentLogger,
    });

    expect(scheduler.enabled).toBe(false);
    scheduler.start();
    expect(scheduler.timer).toBeNull();
  });

  it('clamps a too-eager interval so it cannot hammer the APIs', () => {
    const scheduler = new SheetSyncScheduler({
      receivingService: {}, intervalMs: 500, logger: silentLogger,
    });

    expect(scheduler.intervalMs).toBe(30_000);
  });

  it('falls back to the default for a nonsense value', () => {
    const scheduler = new SheetSyncScheduler({
      receivingService: {}, intervalMs: Number.NaN, logger: silentLogger,
    });

    expect(scheduler.intervalMs).toBe(5 * 60 * 1000);
  });
});

describe('SheetSyncScheduler.runOnce', () => {
  it('records the result of a successful pass', async () => {
    const result = {
      ...emptyResult(),
      advanced: [{ key: 'PARTS-1', from: 'Sent to VFF', to: 'Ordered', row: 23 }],
    };
    const receivingService = { syncFromSheet: jest.fn().mockResolvedValue(result) };

    const scheduler = new SheetSyncScheduler({ receivingService, logger: silentLogger });
    await scheduler.runOnce();

    expect(receivingService.syncFromSheet).toHaveBeenCalledTimes(1);
    expect(scheduler.lastResult).toBe(result);
    expect(scheduler.lastError).toBeNull();
    expect(scheduler.lastRun).not.toBeNull();
  });

  it('swallows a failed pass so the poll survives to the next tick', async () => {
    const receivingService = {
      syncFromSheet: jest.fn().mockRejectedValue(new Error('Sheets 503')),
    };

    const scheduler = new SheetSyncScheduler({ receivingService, logger: silentLogger });

    await expect(scheduler.runOnce()).resolves.toBeNull();
    expect(scheduler.lastError.message).toBe('Sheets 503');
    expect(scheduler.running).toBe(false);
  });

  it('skips an overlapping run rather than queueing it', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const receivingService = {
      syncFromSheet: jest.fn().mockImplementation(() => gate.then(emptyResult)),
    };

    const scheduler = new SheetSyncScheduler({ receivingService, logger: silentLogger });

    const first = scheduler.runOnce();
    const second = await scheduler.runOnce();

    expect(second).toBeNull();
    expect(receivingService.syncFromSheet).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(scheduler.running).toBe(false);
  });

  it('clears the running flag even after a failure, so it is not wedged', async () => {
    const receivingService = {
      syncFromSheet: jest.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(emptyResult()),
    };

    const scheduler = new SheetSyncScheduler({ receivingService, logger: silentLogger });

    await scheduler.runOnce();
    await scheduler.runOnce();

    expect(receivingService.syncFromSheet).toHaveBeenCalledTimes(2);
  });
});

describe('SheetSyncScheduler lifecycle', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('fires on the interval and stops cleanly', async () => {
    jest.useFakeTimers();
    const receivingService = { syncFromSheet: jest.fn().mockResolvedValue(emptyResult()) };

    const scheduler = new SheetSyncScheduler({
      receivingService, intervalMs: 30_000, logger: silentLogger,
    });

    scheduler.start();
    // The first pass waits a full interval rather than running at boot.
    expect(receivingService.syncFromSheet).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000);
    expect(receivingService.syncFromSheet).toHaveBeenCalledTimes(1);

    scheduler.stop();
    jest.advanceTimersByTime(90_000);
    expect(receivingService.syncFromSheet).toHaveBeenCalledTimes(1);
  });

  it('start is idempotent', () => {
    jest.useFakeTimers();
    const scheduler = new SheetSyncScheduler({
      receivingService: { syncFromSheet: jest.fn().mockResolvedValue(emptyResult()) },
      intervalMs: 30_000,
      logger: silentLogger,
    });

    scheduler.start();
    const timer = scheduler.timer;
    scheduler.start();

    expect(scheduler.timer).toBe(timer);
    scheduler.stop();
  });

  it('reports its status', () => {
    const scheduler = new SheetSyncScheduler({
      receivingService: {}, intervalMs: 60_000, logger: silentLogger,
    });

    expect(scheduler.status()).toMatchObject({
      enabled: true, intervalMs: 60_000, running: false, lastRun: null,
    });
  });
});
