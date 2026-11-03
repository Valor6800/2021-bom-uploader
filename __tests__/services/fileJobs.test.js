import { jest } from '@jest/globals';
import { FileJobs } from '../../src/server/services/fileJobs.js';

const origin = { documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', partId: 'JVD' };
const job = (n, extra = {}) => ({ key: `HAR-${n}`, partNumber: `VR27P-${1100 + n}A`, thickness: 'None', origin, ...extra });

function make({ attach, concurrency = 4, parts = [] } = {}) {
  const partFiles = { attach: attach ?? jest.fn().mockResolvedValue({ attached: ['a'], problems: [] }) };
  const onshapeWriter = { readBom: jest.fn().mockResolvedValue({ parts }) };
  return { jobs: new FileJobs({ partFiles, onshapeWriter, concurrency }), partFiles, onshapeWriter };
}

describe('FileJobs', () => {
  it('runs a queued job in the background and reports it done', async () => {
    const { jobs, partFiles } = make();
    expect(jobs.enqueue(job(1))).toBe(true);
    expect(jobs.status(['HAR-1'])).toEqual({ 'HAR-1': { state: 'pending', problems: [] } });
    await jobs.idle();
    expect(partFiles.attach).toHaveBeenCalledWith({ key: 'HAR-1', partNumber: 'VR27P-1101A', origin, thickness: 'None' });
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
    jobs.enqueue({ key: 'HAR-9', partNumber: 'VR27P-1101B', thickness: '0.125', assemblyKey: 'HAR-30' });
    await jobs.idle();
    expect(onshapeWriter.readBom).toHaveBeenCalledWith('HAR-30');
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
});
