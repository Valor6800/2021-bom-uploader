import {
  deriveDesignerRows, mergeLinks, mergeParts, hasNewerRevision, newerRevisionOf,
  linksFromBuildParts, dropAgreedLinks, addSessionLinks, describeChanges,
} from '../../src/client/src/lib/designerRows.js';

const part = (key, number, name, extra = {}) => {
  const m = /^V([RF])(\d{2})P-(\d{4})([A-Z])$/.exec(number);
  return {
    key,
    summary: `${number} ${name}`,
    fullPartNumber: number,
    seasonType: m[1],
    year: m[2],
    partNumber: m[3],
    version: m[4],
    name,
    isEpic: false,
    epic: 'HAR-2030',
    quantity: 1,
    material: 'PLA',
    machinery: '3D Printer',
    powdercoat: 'None',
    thickness: 'None',
    project: 'HAR',
    ...extra,
  };
};

const bomItem = (number, name, extra = {}) => {
  const { key, ...rest } = part('X', number, name, extra);
  return rest;
};

const builds = [
  { key: 'HAR-2051', buildNumber: 1, status: 'Draft', assemblyKey: 'HAR-2030' },
  { key: 'HAR-2052', buildNumber: 2, status: 'Active', assemblyKey: 'HAR-2030' },
];

const P31 = part('HAR-2031', 'VF27P-0001A', 'Test Part');
const P32 = part('HAR-2032', 'VF27P-0002A', 'Plate', { quantity: 2, material: 'AL 6061', machinery: 'CNC Router' });
const P33 = part('HAR-2033', 'VF27P-0003A', 'Bash bar 2"');

const base = (over = {}) => deriveDesignerRows({
  parts: [P31, P32, P33],
  chainKeys: ['HAR-2030'],
  linkedByPart: linksFromBuildParts(new Map([['HAR-2051', ['HAR-2031', 'HAR-2032']], ['HAR-2052', ['HAR-2033']]])),
  linkedThisSession: new Map(),
  buildKey: 'HAR-2051',
  builds,
  ...over,
});

describe('deriveDesignerRows grouping', () => {
  it('splits In Build and Other with labels', () => {
    const { groups, pendingOps } = base();
    expect(groups.inBuild.map((r) => r.key)).toEqual(['HAR-2031', 'HAR-2032']);
    expect(groups.other.map((r) => r.key)).toEqual(['HAR-2033']);
    expect(groups.other[0].label).toBe('Also in Build 2');
    expect(groups.inBuild[0].status).toBe('In Build');
    expect(groups.newFromCad).toEqual([]);
    expect(pendingOps).toEqual([]);
  });

  it('labels a Part in no Build', () => {
    const { groups } = base({ linkedByPart: new Map() });
    expect(groups.other.every((r) => r.label === 'Not in any Build')).toBe(true);
  });

  it('keeps a just-linked Part in the Build while the re-fetch lags, and the entry is droppable once it agrees', () => {
    const lagging = new Map([['HAR-2052', ['HAR-2033']]]);
    const session = new Map([['HAR-2051', new Set(['HAR-2031'])]]);
    const args = {
      linkedByPart: linksFromBuildParts(lagging), linkedThisSession: session, parts: [P31, P33],
    };
    expect(base(args).groups.inBuild.map((r) => r.key)).toEqual(['HAR-2031']);

    const agreed = new Map([['HAR-2051', ['HAR-2031']], ['HAR-2052', ['HAR-2033']]]);
    const dropped = dropAgreedLinks(session, agreed);
    expect(dropped.size).toBe(0);
    expect(base({ ...args, linkedByPart: linksFromBuildParts(agreed), linkedThisSession: dropped })
      .groups.inBuild.map((r) => r.key)).toEqual(['HAR-2031']);
  });

  it('puts a Revision A Part linked to a Revision B Build in that Build', () => {
    const pA = part('HAR-2031', 'VF27P-0001A', 'Test Part', { epic: 'HAR-A' });
    const { groups } = deriveDesignerRows({
      parts: [pA],
      chainKeys: ['HAR-B', 'HAR-A'],
      linkedByPart: linksFromBuildParts(new Map([['HAR-B1', ['HAR-2031']]])),
      buildKey: 'HAR-B1',
    });
    expect(groups.inBuild[0]).toMatchObject({ key: 'HAR-2031', readOnly: false });
  });

  it('marks a linked Part from outside the chain read-only', () => {
    const foreign = part('HAR-3000', 'VF27P-0009A', 'Elsewhere', { epic: 'HAR-9999' });
    const { groups } = base({
      parts: [P31, foreign],
      linkedByPart: linksFromBuildParts(new Map([['HAR-2051', ['HAR-2031', 'HAR-3000']]])),
    });
    const row = groups.inBuild.find((r) => r.key === 'HAR-3000');
    expect(row).toMatchObject({ readOnly: true, readOnlyLabel: 'From another Assembly' });
  });
});

describe('deriveDesignerRows with a CAD preview', () => {
  const preview = {
    newParts: [bomItem('VF27P-0004A', 'Spacer', { quantity: 4, material: 'PETG-CF' })],
    existingParts: [{ bomItem: bomItem('VF27P-0001A', 'Test Part', { quantity: 3 }), story: P31, changes: { count: 1, quantity: 3 } }],
  };

  it('shows New and Changed rows with the CAD detail', () => {
    const { groups, pendingOps } = base({ preview });
    expect(groups.newFromCad.map((r) => r.rowId)).toEqual(['VF27P-0004A']);
    const changed = groups.inBuild.find((r) => r.key === 'HAR-2031');
    expect(changed).toMatchObject({ status: 'Changed', changedInCad: true, dirty: true });
    expect(changed.values.quantity).toBe(3);
    expect(changed.changeText).toBe('Changed in CAD: Qty 1→3');
    expect(pendingOps.sort()).toEqual(['HAR-2031', 'VF27P-0004A']);
  });

  it('lets an edit win over the CAD value', () => {
    const { groups } = base({ preview, edits: { 'HAR-2031': { quantity: 5 } } });
    expect(groups.inBuild.find((r) => r.key === 'HAR-2031').values.quantity).toBe(5);
  });

  it('treats a New row whose key is in createdKeys as that Part', () => {
    const { groups } = base({
      preview,
      createdKeys: { 'VF27P-0004A': 'HAR-2034' },
      rowResults: { 'HAR-2034': { ok: false, error: 'Created, but not added' } },
    });
    expect(groups.newFromCad).toEqual([]);
    const row = groups.other.find((r) => r.key === 'HAR-2034');
    expect(row).toMatchObject({ isNew: false, status: 'Error', dirty: false });
  });

  it('stops showing Changed once the saved values are recorded', () => {
    const { groups } = base({
      preview,
      rowResults: { 'HAR-2031': { ok: true, values: { quantity: 3, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' } } },
    });
    const row = groups.inBuild.find((r) => r.key === 'HAR-2031');
    expect(row).toMatchObject({ status: 'Saved', dirty: false });
  });
});

describe('mergeParts and createdParts', () => {
  const created = part('HAR-2040', 'VF27P-0007A', 'Clone');

  it('keeps a created Part the re-fetch lacks, and the fetched copy once present', () => {
    const map = new Map([['HAR-2040', created]]);
    expect(mergeParts([P31], map).map((p) => p.key)).toEqual(['HAR-2031', 'HAR-2040']);
    const fetchedCopy = { ...created, quantity: 9 };
    const merged = mergeParts([P31, fetchedCopy], map);
    expect(merged).toHaveLength(2);
    expect(merged[1].quantity).toBe(9);
  });

  it('puts a created Part with a session link in the Build', () => {
    const { groups } = base({
      parts: [P31],
      createdParts: new Map([['HAR-2040', created]]),
      linkedThisSession: new Map([['HAR-2051', new Set(['HAR-2040'])]]),
    });
    expect(groups.inBuild.map((r) => r.key)).toContain('HAR-2040');
  });

  it('shows Parts copied into a new Build while its Parts read is empty', () => {
    const session = addSessionLinks(new Map(), 'HAR-2053', ['HAR-2031', 'HAR-2032']);
    const { groups } = base({
      buildKey: 'HAR-2053',
      linkedByPart: linksFromBuildParts(new Map([['HAR-2053', []]])),
      linkedThisSession: session,
      builds: [...builds, { key: 'HAR-2053', buildNumber: 3, status: 'Draft', assemblyKey: 'HAR-2030' }],
    });
    expect(groups.inBuild.map((r) => r.key)).toEqual(['HAR-2031', 'HAR-2032']);
  });
});

describe('mergeLinks', () => {
  it('unions fetched and session links', () => {
    const merged = mergeLinks(new Map([['HAR-1', new Set(['B1'])]]), new Map([['B2', new Set(['HAR-1', 'HAR-2'])]]));
    expect([...merged.get('HAR-1')].sort()).toEqual(['B1', 'B2']);
    expect([...merged.get('HAR-2')]).toEqual(['B2']);
  });
});

describe('hasNewerRevision', () => {
  const a = part('HAR-2035', 'VF27P-0003A', 'Bash bar');
  const b = part('HAR-2041', 'VF27P-0003B', 'Bash bar');
  it('is true with a later letter and names the newest', () => {
    expect(hasNewerRevision(a, [a, b])).toBe(true);
    expect(newerRevisionOf(a, [a, b]).key).toBe('HAR-2041');
  });
  it('is false for the newest one', () => {
    expect(hasNewerRevision(b, [b])).toBe(false);
  });
  it('is false for another number', () => {
    expect(hasNewerRevision(a, [a, part('HAR-9', 'VF27P-0004B', 'Other')])).toBe(false);
  });
  it('sees a B that exists only in createdParts', () => {
    expect(hasNewerRevision(a, mergeParts([a], new Map([['HAR-2041', b]])))).toBe(true);
  });
});

describe('describeChanges', () => {
  it('is empty with no changes', () => {
    expect(describeChanges({})).toBe('');
  });
});
