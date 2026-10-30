import {
  buildLabel, buildSummaryPreview, nextBuildNumber, visibleBuilds, pickerBuilds, defaultBuildKey,
  mergeBuilds, overlayBuildStatus, dropAgreedStatus, activeConflict, conflictSignature,
  statusCheckKeys, repairCandidates, supersedeTargets, cutResultEntries, cutErrorEntries,
  statusCheckEntries, listLabels,
} from '../../src/client/src/lib/buildNames.js';

const DOC = '8c64dfdcb66184646a7a3f17';
const LINK = `https://cad.onshape.com/documents/${DOC}/v/aaaaaaaaaaaaaaaaaaaaaaaa/e/faea62821490977c33bc8d7c`;
const OTHER_LINK = 'https://cad.onshape.com/documents/111111111111111111111111/v/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc';

const build = (key, buildNumber, status, extra = {}) => ({
  key, buildNumber, status, assemblyKey: 'HAR-2030', summary: `Test Assembly Build ${buildNumber}`,
  onshapeVersionLink: null, ...extra,
});

describe('buildLabel', () => {
  it('uses the number, then the summary', () => {
    expect(buildLabel(build('HAR-2051', 3, 'Draft'))).toBe('Build 3');
    expect(buildLabel({ key: 'HAR-1', buildNumber: null, summary: 'Old one' })).toBe('Old one');
  });
});

describe('buildSummaryPreview', () => {
  it('has no suffix without a description', () => {
    expect(buildSummaryPreview('Test Assembly', 3, '')).toBe('Test Assembly Build 3');
  });
  it('collapses whitespace in the description', () => {
    expect(buildSummaryPreview('Test Assembly', 3, '  1in   bash bar ')).toBe('Test Assembly Build 3 - 1in bash bar');
  });
  it('treats a whitespace-only description as absent', () => {
    expect(buildSummaryPreview('Test Assembly', 3, '   ')).toBe('Test Assembly Build 3');
  });
});

describe('nextBuildNumber and visibleBuilds', () => {
  it('numbers across the whole chain', () => {
    const chainBuilds = [
      { ...build('HAR-A1', 1, 'Superseded'), assemblyKey: 'HAR-A' },
      { ...build('HAR-A2', 2, 'Active'), assemblyKey: 'HAR-A' },
    ];
    expect(visibleBuilds(chainBuilds, 'HAR-B')).toEqual([]);
    expect(nextBuildNumber(chainBuilds)).toBe(3);
  });
  it('starts at 1', () => {
    expect(nextBuildNumber([])).toBe(1);
  });
});

describe('pickerBuilds', () => {
  it('hides Archived unless selected', () => {
    const list = [build('HAR-1', 1, 'Archived'), build('HAR-2', 2, 'Draft')];
    expect(pickerBuilds(list, 'HAR-2').map((b) => b.key)).toEqual(['HAR-2']);
    expect(pickerBuilds(list, 'HAR-1').map((b) => b.key)).toEqual(['HAR-1', 'HAR-2']);
  });
});

describe('defaultBuildKey', () => {
  const list = [build('HAR-1', 1, 'Superseded'), build('HAR-2', 2, 'Active'), build('HAR-3', 3, 'Draft'), build('HAR-4', 4, 'Archived')];
  it('honours a requested Build in the list', () => {
    expect(defaultBuildKey(list, 'HAR-1')).toBe('HAR-1');
  });
  it('prefers the newest Draft, then Active, then the highest number', () => {
    expect(defaultBuildKey(list, 'HAR-99')).toBe('HAR-3');
    expect(defaultBuildKey(list.filter((b) => b.key !== 'HAR-3'), null)).toBe('HAR-2');
    expect(defaultBuildKey([build('HAR-1', 1, 'Superseded'), build('HAR-5', 5, 'Superseded')], null)).toBe('HAR-5');
  });
  it('never defaults to an Archived Build', () => {
    expect(defaultBuildKey([build('HAR-4', 4, 'Archived')], null)).toBeNull();
  });
});

describe('mergeBuilds', () => {
  const fetched = [build('HAR-2051', 1, 'Draft')];
  it('is a no-op for null', () => {
    expect(mergeBuilds(fetched, null)).toBe(fetched);
  });
  it('keeps the fetched copy when the key is already there', () => {
    const merged = mergeBuilds(fetched, { ...build('HAR-2051', 1, 'Draft'), summary: 'stale' });
    expect(merged).toHaveLength(1);
    expect(merged[0].summary).toBe('Test Assembly Build 1');
  });
  it('adds a missing Build, which defaultBuildKey then picks', () => {
    const extra = build('HAR-2051', 1, 'Draft');
    const merged = mergeBuilds([], extra);
    expect(merged).toEqual([extra]);
    expect(defaultBuildKey(merged, null)).toBe('HAR-2051');
  });
  it('accepts a list of extras', () => {
    expect(mergeBuilds(fetched, [build('HAR-2052', 2, 'Draft'), null]).map((b) => b.key)).toEqual(['HAR-2051', 'HAR-2052']);
  });
});

describe('overlayBuildStatus and dropAgreedStatus', () => {
  it('keeps a cut result over a lagging re-fetch, then drops agreed entries', () => {
    const overlay = new Map(cutResultEntries('HAR-2051', { onshapeVersionLink: LINK, superseded: ['HAR-2052'] }));
    const lagging = [build('HAR-2051', 1, 'Draft'), build('HAR-2052', 2, 'Active')];
    const shown = overlayBuildStatus(lagging, overlay);
    expect(shown[0]).toMatchObject({ status: 'Active', onshapeVersionLink: LINK });
    expect(shown[1].status).toBe('Superseded');

    const agreed = [build('HAR-2051', 1, 'Active', { onshapeVersionLink: LINK }), build('HAR-2052', 2, 'Superseded')];
    const dropped = dropAgreedStatus(overlay, agreed);
    expect(dropped.size).toBe(0);
    expect(overlayBuildStatus(agreed, dropped)).toEqual(agreed);
  });

  it('uses a 409 buildStatus, never the HTTP status', () => {
    const err = { status: 409, body: { status: 409, buildStatus: 'Active' } };
    const overlay = new Map(cutErrorEntries('HAR-2051', err));
    expect(overlayBuildStatus([build('HAR-2051', 1, 'Draft')], overlay)[0].status).toBe('Active');
  });

  it('adds no entry for a 409 without buildStatus', () => {
    const err = { status: 409, body: { status: 409, error: 'x' } };
    expect(cutErrorEntries('HAR-2051', err)).toEqual([]);
    const fetched = [build('HAR-2051', 1, 'Draft')];
    expect(overlayBuildStatus(fetched, new Map())).toBe(fetched);
  });
});

describe('activeConflict', () => {
  it('finds two Active after a supersede-stage failure and none after the resume', () => {
    const fetched = [build('HAR-2051', 1, 'Draft'), build('HAR-2052', 2, 'Active', { onshapeVersionLink: LINK })];
    const err = { status: 503, body: { cutStage: 'supersede', onshapeVersionLink: LINK } };
    let overlay = new Map(cutErrorEntries('HAR-2051', err));
    expect(activeConflict(overlayBuildStatus(fetched, overlay)).map((b) => b.key)).toEqual(['HAR-2051', 'HAR-2052']);

    overlay = new Map([...overlay, ...cutResultEntries('HAR-2051', { onshapeVersionLink: LINK, superseded: ['HAR-2052'] })]);
    expect(activeConflict(overlayBuildStatus(fetched, overlay))).toEqual([]);
  });

  it('is empty when a by-key check says one is Superseded or missing', () => {
    const fetched = [build('HAR-2051', 1, 'Active'), build('HAR-2052', 2, 'Active')];
    const superseded = new Map(statusCheckEntries({
      builds: [{ key: 'HAR-2051', status: 'Active', onshapeVersionLink: LINK }, { key: 'HAR-2052', status: 'Superseded', onshapeVersionLink: null }],
      missing: [],
    }));
    expect(activeConflict(overlayBuildStatus(fetched, superseded))).toEqual([]);

    const missing = new Map(statusCheckEntries({ builds: [{ key: 'HAR-2051', status: 'Active' }], missing: ['HAR-2052'] }));
    expect(activeConflict(overlayBuildStatus(fetched, missing))).toEqual([]);
  });

  it('signs a conflict by sorted keys and checks at most 10, highest first', () => {
    const conflict = Array.from({ length: 12 }, (_, i) => build(`HAR-${100 + i}`, i + 1, 'Active'));
    expect(conflictSignature([conflict[1], conflict[0]])).toBe('HAR-100,HAR-101');
    const keys = statusCheckKeys(conflict);
    expect(keys).toHaveLength(10);
    expect(keys[0]).toBe('HAR-111');
  });
});

describe('repairCandidates and supersedeTargets', () => {
  const b1 = build('HAR-2051', 1, 'Active', { onshapeVersionLink: LINK });
  const b2 = build('HAR-2052', 2, 'Active', { onshapeVersionLink: LINK });
  const b2other = build('HAR-2052', 2, 'Active', { onshapeVersionLink: OTHER_LINK });

  it('offers only the Build whose cut failed', () => {
    expect(repairCandidates({ conflict: [b1, b2], cutFailedKey: 'HAR-2051', documentId: DOC }))
      .toEqual([{ build: b1, label: 'Finish cutting Build 1' }]);
  });
  it('otherwise offers Builds cut from this document only', () => {
    expect(repairCandidates({ conflict: [b1, b2other], cutFailedKey: null, documentId: DOC }))
      .toEqual([{ build: b1, label: 'Make Build 1 the Active one' }]);
  });
  it('offers nothing without a document', () => {
    expect(repairCandidates({ conflict: [b1, b2], cutFailedKey: null, documentId: '' })).toEqual([]);
  });
  it('names the other Builds', () => {
    expect(supersedeTargets([b1, b2], 'HAR-2051')).toEqual([b2]);
    expect(listLabels([b1, b2])).toBe('Build 1 and Build 2');
    expect(listLabels([b1, b2, build('HAR-3', 3, 'Active')])).toBe('Build 1, Build 2 and Build 3');
  });
});
