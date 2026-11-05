import { addWatch, failureText, settle, watchFrom } from '../../src/client/src/lib/fileStatus.js';

describe('watchFrom', () => {
  it('watches the Parts a Save made whose files are pending, by their number', () => {
    const results = [
      { ref: 'VR27P-1101A', op: 'create', ok: true, key: 'HAR-10', filesPending: true },
      { ref: 'VR27P-1102A', op: 'create', ok: true, key: 'HAR-11', filesPending: true, fullPartNumber: 'VR27P-1103A' },
      { ref: 'HAR-12', op: 'update', ok: true, key: 'HAR-12' },
      { ref: 'VR27P-1104A', op: 'create', ok: false, key: null },
    ];
    expect(watchFrom(results)).toEqual([{ key: 'HAR-10', name: 'VR27P-1101A' }, { key: 'HAR-11', name: 'VR27P-1103A' }]);
    expect(watchFrom(undefined)).toEqual([]);
  });

  it('keeps one entry per Part when a Part is added twice', () => {
    expect(addWatch([{ key: 'HAR-10', name: 'a' }], [{ key: 'HAR-10', name: 'a' }, { key: 'HAR-11', name: 'b' }]).map((w) => w.key)).toEqual(['HAR-10', 'HAR-11']);
  });
});

describe('settle', () => {
  const watching = [{ key: 'HAR-1', name: 'A' }, { key: 'HAR-2', name: 'B' }, { key: 'HAR-3', name: 'C' }, { key: 'HAR-4', name: 'D' }];

  it('keeps watching what is pending, and sorts the rest into done and failed', () => {
    const result = settle(watching, {
      'HAR-1': { state: 'pending', problems: [] },
      'HAR-2': { state: 'done', problems: [] },
      'HAR-3': { state: 'failed', problems: ['x.step: OnShape refused the change (403)'] },
    });
    expect(result.stillWatching.map((w) => w.key)).toEqual(['HAR-1']);
    expect(result.finished.map((w) => w.key)).toEqual(['HAR-2', 'HAR-4']);
    expect(result.failed).toEqual([{ key: 'HAR-3', name: 'C', problems: ['x.step: OnShape refused the change (403)'] }]);
  });

  it('lets go of a Part the server does not know, without a warning', () => {
    const result = settle(watching, {});
    expect(result.stillWatching).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.finished).toHaveLength(4);
  });
});

describe('failureText', () => {
  it('names the Parts and says what to do', () => {
    expect(failureText([{ key: 'HAR-3', name: 'VR27P-1103A', problems: [] }, { key: 'HAR-4', name: 'VR27P-1104A', problems: [] }]))
      .toBe("Couldn't attach all the files to VR27P-1103A, VR27P-1104A. Once the Build is cut, the Assembly page can make them again.");
    expect(failureText([])).toBe('');
  });
});
