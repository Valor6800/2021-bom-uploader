import {
  deriveDesignerRows, mergeLinks, mergeParts,
  linksFromBuildParts, dropAgreedLinks, addSessionLinks, describeChanges,
  dropAgreedParts, compareBuildRows, dropAgreedUnlinks,
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
  it('lists the selected Build Parts and hides Parts that are only in other Builds', () => {
    const { groups, pendingOps } = base();
    expect(groups.inBuild.map((r) => r.key)).toEqual(['HAR-2031', 'HAR-2032']);
    expect(groups.other).toEqual([]);
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

describe('describeChanges', () => {
  it('is empty with no changes', () => {
    expect(describeChanges({})).toBe('');
  });
});

describe('dropAgreedParts', () => {
  const created = part('HAR-2040', 'VF27P-0007A', 'Clone');
  it('keeps entries the re-fetch lacks and returns the same Map', () => {
    const map = new Map([['HAR-2040', created]]);
    expect(dropAgreedParts(map, [P31])).toBe(map);
  });
  it('drops entries once the re-fetch lists the new key', () => {
    expect(dropAgreedParts(new Map([['HAR-2040', created]]), [P31, created]).size).toBe(0);
  });
});

describe('compareBuildRows', () => {
  const P33 = part('HAR-2033', 'VF27P-0003A', 'Bash bar 2"');
  const P35 = part('HAR-2035', 'VF27P-0003B', 'Bash bar 1"');
  const links = new Map([
    ['HAR-2031', new Set(['B2', 'B3'])],
    ['HAR-2033', new Set(['B2'])],
    ['HAR-2035', new Set(['B3'])],
    ['HAR-2032', new Set(['B1'])],
  ]);
  it('lists shared Parts first, then by summary, and skips Parts in neither', () => {
    const rows = compareBuildRows([P35, P33, P32, P31], links, 'B2', 'B3');
    expect(rows.map((r) => [r.part.key, r.inA, r.inB])).toEqual([
      ['HAR-2031', true, true],
      ['HAR-2033', true, false],
      ['HAR-2035', false, true],
    ]);
  });
  it('is empty until both Builds are chosen', () => {
    expect(compareBuildRows([P31], links, 'B2', '')).toEqual([]);
  });
});

describe('deriveDesignerRows locks Parts a cut Build uses', () => {
  // Draft Build 1 holds HAR-2031 (Draft-only) and HAR-2033 (also in Active Build 2).
  const shared = (over = {}) => base({
    linkedByPart: linksFromBuildParts(new Map([
      ['HAR-2051', ['HAR-2031', 'HAR-2033']],
      ['HAR-2052', ['HAR-2033']],
    ])),
    ...over,
  });
  const row = (groups, key) => [...groups.inBuild, ...groups.other].find((r) => r.key === key);

  it('marks the shared row locked with the cut Build, and leaves a Draft-only row editable', () => {
    const { groups } = shared();
    expect(row(groups, 'HAR-2033')).toMatchObject({ sharedLocked: true, lockedLabel: 'In cut Build 2' });
    expect(row(groups, 'HAR-2031')).toMatchObject({ sharedLocked: false, lockedLabel: null });
  });

  it('ignores edits and CAD values on a locked row, but still describes the CAD change', () => {
    const { groups, pendingOps } = shared({
      edits: { 'HAR-2033': { quantity: 5 }, 'HAR-2031': { quantity: 7 } },
      preview: { newParts: [], existingParts: [{ story: { key: 'HAR-2033' }, bomItem: { ...bomItem('VF27P-0003A', 'Bash bar 2"'), quantity: 3 } }] },
    });
    const locked = row(groups, 'HAR-2033');
    expect(locked.values.quantity).toBe(1);
    expect(locked.dirty).toBe(false);
    expect(locked.changeText).toBe('Changed in CAD: Qty 1→3');
    expect(row(groups, 'HAR-2031')).toMatchObject({ dirty: true, values: expect.objectContaining({ quantity: 7 }) });
    expect(pendingOps).toEqual(['HAR-2031', 'copy:HAR-2033']);
  });

  it('asks for a copy of the units CAD needs beyond what the Build holds', () => {
    const { groups } = shared({
      preview: { newParts: [], existingParts: [{ story: { key: 'HAR-2033' }, bomItem: { ...bomItem('VF27P-0003A', 'Bash bar 2"'), quantity: 3 } }] },
    });
    const copy = groups.newFromCad.find((r) => r.isCopy);
    expect(copy).toMatchObject({
      rowId: 'copy:HAR-2033', copyOf: 'HAR-2033', fullPartNumber: 'VF27P-0003A', key: null,
      values: expect.objectContaining({ quantity: 2 }),
    });
    expect(copy.revisionNote.text).toBe('CAD needs 3; 1 already in this Build. Make 2 more.');
  });

  it('asks for nothing once the Build holds the units CAD needs', () => {
    const { groups } = shared({
      preview: { newParts: [], existingParts: [{ story: { key: 'HAR-2033' }, bomItem: { ...bomItem('VF27P-0003A', 'Bash bar 2"'), quantity: 1 } }] },
    });
    expect(groups.newFromCad).toEqual([]);
  });

  it('does not lock a Part whose other Builds are all Drafts', () => {
    const { groups } = shared({ builds: builds.map((b) => ({ ...b, status: 'Draft' })) });
    expect(row(groups, 'HAR-2033').sharedLocked).toBe(false);
  });
});

describe('Material is locked', () => {
  it('ignores an edit to material and keeps the stored value', () => {
    const { groups } = base({ edits: { 'HAR-2031': { material: 'AL 6061', quantity: 5 } } });
    const row = groups.inBuild.find((r) => r.key === 'HAR-2031');
    expect(row.values.material).toBe('PLA');
    expect(row.values.quantity).toBe(5);
  });

  it('ignores a material edit on a New row but keeps the CAD material', () => {
    const preview = { newParts: [bomItem('VF27P-0004A', 'Spacer', { material: 'PETG-CF' })], existingParts: [] };
    const { groups } = base({ preview, edits: { 'VF27P-0004A': { material: 'PLA' } } });
    expect(groups.newFromCad[0].values.material).toBe('PETG-CF');
  });

  it('still applies a changed material from CAD', () => {
    const preview = {
      newParts: [],
      existingParts: [{ story: P31, bomItem: bomItem('VF27P-0001A', 'Test Part', { material: 'PETG-CF' }), changes: { count: 1 } }],
    };
    const row = base({ preview }).groups.inBuild.find((r) => r.key === 'HAR-2031');
    expect(row.values.material).toBe('PETG-CF');
    expect(row.changeText).toContain('Material PLA→PETG-CF');
  });
});

describe('The tool owns Revisions and numbers', () => {
  it('shows a part CAD has no number for as a New row with the number the tool proposes', () => {
    const item = { ...bomItem('VF27P-0009A', 'Gusset'), cadRef: 'd:e:JVD:', proposedNumber: true };
    const { groups } = base({ preview: { newParts: [item], existingParts: [] } });
    expect(groups.newFromCad).toHaveLength(1);
    expect(groups.newFromCad[0]).toMatchObject({
      isNew: true, fullPartNumber: 'VF27P-0009A', cadRef: 'd:e:JVD:', proposedNumber: true, revision: 'A',
    });
    expect(groups.newFromCad[0].revisionNote).toBeNull();
  });

  it('matches a CAD part to its tracker Part whatever Revision letter CAD shows', () => {
    const p31b = part('HAR-2041', 'VF27P-0001B', 'Test Part');
    const preview = { newParts: [], existingParts: [{ story: p31b, bomItem: bomItem('VF27P-0001A', 'Test Part'), changes: { count: 0 } }] };
    const { groups } = base({
      parts: [P31, p31b],
      linkedByPart: linksFromBuildParts(new Map([['HAR-2051', ['HAR-2041']]])),
      preview,
    });
    expect(groups.inBuild.map((r) => r.key)).toEqual(['HAR-2041']);
    expect(groups.newFromCad).toEqual([]);
  });

  it('takes a replaced Revision out of the Build at once, before search agrees', () => {
    const p31b = part('HAR-2041', 'VF27P-0001B', 'Test Part');
    const { groups } = base({
      parts: [P31, p31b, P32],
      linkedThisSession: new Map([['HAR-2051', new Set(['HAR-2041'])]]),
      unlinkedThisSession: new Map([['HAR-2051', new Set(['HAR-2031'])]]),
    });
    expect(groups.inBuild.map((r) => r.key)).toEqual(['HAR-2041', 'HAR-2032']);
  });
});

describe('mergeLinks and dropAgreedUnlinks', () => {
  it('removes this session unlinks from the fetched links', () => {
    const links = mergeLinks(
      linksFromBuildParts(new Map([['HAR-2051', ['HAR-2031', 'HAR-2032']]])),
      new Map(),
      new Map([['HAR-2051', new Set(['HAR-2031'])]]),
    );
    expect(links.get('HAR-2031').has('HAR-2051')).toBe(false);
    expect(links.get('HAR-2032').has('HAR-2051')).toBe(true);
  });

  it('forgets an unlink once a fetch of that Build no longer lists the Part', () => {
    const unlinked = new Map([['HAR-2051', new Set(['HAR-2031'])]]);
    expect(dropAgreedUnlinks(unlinked, new Map([['HAR-2051', ['HAR-2031']]]))).toBe(unlinked);
    expect(dropAgreedUnlinks(unlinked, new Map([['HAR-2051', ['HAR-2032']]])).size).toBe(0);
  });
});

describe('Parts in other Builds are hidden; Parts in no Build show', () => {
  const SPARE_OF_31 = part('HAR-2040', 'VF27P-0001A', 'Test Part');
  const FREE = part('HAR-2041', 'VF27P-0009A', 'Fastener plate');

  it('shows a Part that is in no Build at all', () => {
    const { groups } = base({ parts: [P31, P32, P33, FREE] });
    expect(groups.other.map((r) => r.key)).toEqual(['HAR-2041']);
    expect(groups.other[0].label).toBe('Not in any Build');
  });

  it('shows a Part from another Build once CAD lists it, labelled with that Build', () => {
    const preview = {
      newParts: [],
      existingParts: [{ story: P33, bomItem: bomItem('VF27P-0003A', 'Bash bar 2"'), changes: { count: 0 } }],
    };
    const { groups } = base({ preview });
    // Build 2 made it, and this Build isn't reusing it: the tool makes it again.
    expect(groups.other).toEqual([]);
    expect(groups.newFromCad).toEqual([expect.objectContaining({
      rowId: 'copy:HAR-2033', isCopy: true, values: expect.objectContaining({ quantity: 1 }),
    })]);
    expect(groups.newFromCad[0].revisionNote.text).toBe('Make 1 new.');
  });

  it('shows a Part a Draft alone uses when CAD lists it, to add to this Build', () => {
    const drafts = [...builds, { key: 'HAR-2053', buildNumber: 3, status: 'Draft', assemblyKey: 'HAR-2030' }];
    const preview = {
      newParts: [],
      existingParts: [{ story: P33, bomItem: bomItem('VF27P-0003A', 'Bash bar 2"'), changes: { count: 0 } }],
    };
    const { groups } = base({
      builds: drafts,
      linkedByPart: linksFromBuildParts(new Map([['HAR-2051', ['HAR-2031']], ['HAR-2053', ['HAR-2033']]])),
      preview,
    });
    expect(groups.other.map((r) => r.key)).toContain('HAR-2033');
  });

  it('keeps a hidden Part out of the way of a Build with nothing selected', () => {
    const { groups, pendingOps } = base({ buildKey: 'HAR-2052' });
    expect(groups.inBuild.map((r) => r.key)).toEqual(['HAR-2033']);
    expect(groups.other.map((r) => r.key)).toEqual([]);
    expect(pendingOps).toEqual([]);
  });

  it('labels a copy of an existing number as a Spare and the lowest key as the original', () => {
    const { groups } = base({ parts: [P31, P32, P33, SPARE_OF_31] });
    const spare = groups.other.find((r) => r.key === 'HAR-2040');
    expect(spare).toMatchObject({ isSpare: true, label: 'Spare', status: 'Spare', fullPartNumber: 'VF27P-0001A' });
    expect(groups.inBuild.find((r) => r.key === 'HAR-2031').isSpare).toBe(false);
  });

  it('lets CAD update the original, never the spare', () => {
    const preview = {
      newParts: [],
      existingParts: [{ story: P31, bomItem: bomItem('VF27P-0001A', 'Test Part', { quantity: 4 }), changes: { count: 1 } }],
    };
    const { groups } = base({ parts: [P31, P32, P33, SPARE_OF_31], preview });
    expect(groups.inBuild.find((r) => r.key === 'HAR-2031').values.quantity).toBe(4);
    expect(groups.other.find((r) => r.key === 'HAR-2040').values.quantity).toBe(1);
  });

  it('does not offer a New row for a number a spare repeats when the original is saved', () => {
    const preview = { newParts: [bomItem('VF27P-0009A', 'Fastener plate')], existingParts: [] };
    const { groups } = base({ parts: [P31, P32, P33, FREE], preview, createdKeys: {} });
    expect(groups.newFromCad).toEqual([]);
    expect(groups.other.map((r) => r.key)).toEqual(['HAR-2041']);
  });
});

describe('Priority', () => {
  const withPriority = (p, priority) => ({ ...p, priority });

  it('shows the stored priority and is not dirty until it changes', () => {
    const { groups, pendingOps } = base({ parts: [withPriority(P31, 'High'), P32, P33] });
    const row = groups.inBuild.find((r) => r.key === 'HAR-2031');
    expect(row.values.priority).toBe('High');
    expect(row.dirty).toBe(false);
    expect(pendingOps).toEqual([]);
  });

  it('is dirty once an edit changes it, and the row becomes Changed', () => {
    const { groups, pendingOps } = base({
      parts: [withPriority(P31, 'High'), P32, P33],
      edits: { 'HAR-2031': { priority: 'Low' } },
    });
    const row = groups.inBuild.find((r) => r.key === 'HAR-2031');
    expect(row.values.priority).toBe('Low');
    expect(row.stored.priority).toBe('High');
    expect(row.dirty).toBe(true);
    expect(row.status).toBe('Changed');
    expect(pendingOps).toEqual(['HAR-2031']);
  });

  it('treats a Part with no priority as not set, and setting one as a change', () => {
    const unset = base({ parts: [withPriority(P31, null), P32, P33] }).groups.inBuild[0];
    expect(unset.values.priority).toBeNull();
    expect(unset.dirty).toBe(false);
    const set = base({ parts: [withPriority(P31, null), P32, P33], edits: { 'HAR-2031': { priority: 'Medium' } } })
      .groups.inBuild[0];
    expect(set.dirty).toBe(true);
  });

  it('is not touched by CAD', () => {
    const preview = {
      newParts: [],
      existingParts: [{ story: P31, bomItem: bomItem('VF27P-0001A', 'Test Part', { quantity: 9 }), changes: { count: 1 } }],
    };
    const row = base({ parts: [withPriority(P31, 'High'), P32, P33], preview }).groups.inBuild[0];
    expect(row.values.priority).toBe('High');
    expect(row.values.quantity).toBe(9);
  });

  it('lets a New row carry a priority picked before saving', () => {
    const preview = { newParts: [bomItem('VF27P-0004A', 'Spacer')], existingParts: [] };
    const row = base({ preview, edits: { 'VF27P-0004A': { priority: 'Highest' } } }).groups.newFromCad[0];
    expect(row.values.priority).toBe('Highest');
  });
});
