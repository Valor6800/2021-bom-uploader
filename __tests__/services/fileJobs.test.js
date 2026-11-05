import { jest } from '@jest/globals';
import { FileJobs } from '../../src/server/services/fileJobs.js';

const origin = { documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', partId: 'JVD' };
const job = (n, extra = {}) => ({ key: `HAR-${n}`, partNumber: `VR27P-${1100 + n}A`, thickness: 'None', origin, ...extra });

function make({ attach, attachSteps, concurrency = 4, parts = [] } = {}) {
  const partFiles = {
    attach: attach ?? jest.fn().mockResolvedValue({ attached: ['a'], problems: [] }),
    attachSteps: attachSteps ?? jest.fn(async (studio, list) => new Map(list.map((p) => [p.key, { attached: [`${p.partNumber}.step`], problems: [] }]))),
  };
  const onshapeWriter = { readBom: jest.fn().mockResolvedValue({ parts }) };
  return { jobs: new FileJobs({ partFiles, onshapeWriter, concurrency }), partFiles, onshapeWriter };
}

describe('FileJobs', () => {
  it('runs a queued job in the background and reports it done', async () => {
    const { jobs, partFiles } = make();
    expect(jobs.enqueue(job(1))).toBe(true);
    expect(jobs.status(['HAR-1'])).toEqual({ 'HAR-1': { state: 'pending', problems: [] } });
    await jobs.idle();
    expect(partFiles.attach).toHaveBeenCalledWith({ key: 'HAR-1', partNumber: 'VR27P-1101A', origin, thickness: 'None', step: 'later', color: null });
    expect(jobs.status(['HAR-1'])).toEqual({ 'HAR-1': { state: 'done', problems: [] } });
  });

  it('works on only a few Parts at a time', async () => {
    let running = 0;
    let peak = 0;
    const attach = jest.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      running -= 1;
      return { attached: [], problems: [] };
    });
    const { jobs } = make({ attach, concurrency: 2 });
    [1, 2, 3, 4, 5].forEach((n) => jobs.enqueue(job(n)));
    await jobs.idle();
    expect(attach).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });

  it('finds the part in the Assembly BOM by its number when the job has no location, whatever the letter', async () => {
    const found = { ...origin, partId: 'FOUND' };
    const { jobs, partFiles, onshapeWriter } = make({ parts: [{ fullPartNumber: 'VR27P-1101A', origin: found }] });
    jobs.enqueue({ key: 'HAR-9', partNumber: 'VR27P-1101B', thickness: '0.125', assemblyKey: 'HAR-30', versionLink: 'v-link' });
    await jobs.idle();
    // In the cut version's BOM, when the job names it.
    expect(onshapeWriter.readBom).toHaveBeenCalledWith('HAR-30', { versionLink: 'v-link' });
    expect(partFiles.attach).toHaveBeenCalledWith(expect.objectContaining({ origin: found, thickness: '0.125' }));
    expect(jobs.status(['HAR-9'])['HAR-9'].state).toBe('done');
  });

  it('fails a job whose part is not in the BOM, and one whose files could not all be attached', async () => {
    const a = make();
    a.jobs.enqueue({ key: 'HAR-9', partNumber: 'VR27P-1101A', assemblyKey: 'HAR-30' });
    await a.jobs.idle();
    expect(a.jobs.status(['HAR-9'])['HAR-9']).toEqual({ state: 'failed', problems: ["couldn't find VR27P-1101A in OnShape"] });

    const b = make({ attach: jest.fn().mockResolvedValue({ attached: [], problems: ["VR27P-1101A.step: OnShape didn't respond (502)"] }) });
    b.jobs.enqueue(job(1));
    await b.jobs.idle();
    expect(b.jobs.status(['HAR-1'])['HAR-1']).toEqual({ state: 'failed', problems: ["VR27P-1101A.step: OnShape didn't respond (502)"] });
  });

  it('reports a job that throws instead of stopping the queue', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const attach = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OnshapeApiError', status: 502 }))
      .mockResolvedValue({ attached: [], problems: [] });
    const { jobs } = make({ attach, concurrency: 1 });
    jobs.enqueue(job(1));
    jobs.enqueue(job(2));
    await jobs.idle();
    expect(jobs.status(['HAR-1', 'HAR-2'])).toEqual({
      'HAR-1': { state: 'failed', problems: ["OnShape didn't respond (502)"] },
      'HAR-2': { state: 'done', problems: [] },
    });
    warn.mockRestore();
  });

  it('does not queue a Part twice while it is queued or just done, but retries one that failed', async () => {
    const attach = jest.fn()
      .mockResolvedValueOnce({ attached: [], problems: ['x'] })
      .mockResolvedValue({ attached: [], problems: [] });
    const { jobs } = make({ attach });
    expect(jobs.enqueue(job(1))).toBe(true);
    expect(jobs.enqueue(job(1))).toBe(false); // still pending
    await jobs.idle();
    expect(jobs.enqueue(job(1))).toBe(true); // failed: try again
    await jobs.idle();
    expect(jobs.enqueue(job(1))).toBe(false); // done a moment ago
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('knows nothing about a ticket it was never given', () => {
    expect(make().jobs.status(['HAR-1'])).toEqual({});
  });

  it('exports the 3D prints of a Part Studio in one STEP export once the queue drains, and finishes them then', async () => {
    const attach = jest.fn(async ({ key }) => ({ attached: [], problems: [], needsStep: key !== 'HAR-3' }));
    const other = { ...origin, elementId: 'e2' };
    const { jobs, partFiles } = make({ attach });
    jobs.enqueue(job(1));
    jobs.enqueue(job(2, { origin: { ...origin, partId: 'J2D' } }));
    jobs.enqueue(job(3));
    jobs.enqueue(job(4, { origin: { ...other, partId: 'J4D' } }));
    await jobs.idle();
    expect(partFiles.attachSteps).toHaveBeenCalledTimes(2);
    const [[studioA, partsA], [studioB, partsB]] = partFiles.attachSteps.mock.calls;
    expect(studioA).toEqual({ documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e' });
    expect(partsA.map((p) => [p.key, p.partId])).toEqual([['HAR-1', 'JVD'], ['HAR-2', 'J2D']]);
    expect(studioB.elementId).toBe('e2');
    expect(partsB.map((p) => p.key)).toEqual(['HAR-4']);
    expect(Object.values(jobs.status(['HAR-1', 'HAR-2', 'HAR-3', 'HAR-4'])).map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('keeps a Part pending until its STEP is on, and fails it when the export does', async () => {
    let release;
    const attachSteps = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const { jobs } = make({ attach: jest.fn().mockResolvedValue({ attached: [], problems: [], needsStep: true }), attachSteps });
    jobs.enqueue(job(1));
    await new Promise((r) => { setTimeout(r, 0); });
    await new Promise((r) => { setTimeout(r, 0); });
    expect(jobs.status(['HAR-1'])['HAR-1'].state).toBe('pending');
    release(new Map([['HAR-1', { attached: [], problems: ['VR27P-1101A.step: OnShape took too long'] }]]));
    await jobs.idle();
    expect(jobs.status(['HAR-1'])['HAR-1']).toEqual({ state: 'failed', problems: ['VR27P-1101A.step: OnShape took too long'] });
  });
});
