import { deriveDesignerRows, linksFromBuildParts } from '../../src/client/src/lib/designerRows.js';
import { planSave, applySaveResults, bodySize } from '../../src/client/src/lib/designerSave.js';

const VALUES = { quantity: 2, material: 'AL 6061', machinery: 'None', powdercoat: 'None', thickness: 'None' };
const builds = [{ key: 'HAR-51', buildNumber: 1, status: 'Draft' }];
const item = (number, name, extra = {}) => ({
  summary: `${number} ${name}`, fullPartNumber: number, seasonType: 'R', year: '27', partNumber: number.slice(5, 9), version: 'A', name, epic: 'HAR-1', ...VALUES, ...extra,
});

function session({ parts = [], preview, edits = {}, selection, linked = [] }) {
  let work = { edits, createdKeys: {}, linkedThisSession: new Map(), selection: new Set(selection), rowResults: {} };
  const derive = (fetched) => deriveDesignerRows({
    parts: fetched, chainKeys: ['HAR-1'], linkedByPart: linksFromBuildParts(new Map([['HAR-51', linked]])),
    linkedThisSession: work.linkedThisSession, buildKey: 'HAR-51', builds, preview,
    edits: work.edits, createdKeys: work.createdKeys, rowResults: work.rowResults,
  });
  return {
    get work() { return work; },
    derive,
    save(fetched, results) {
      const { groups } = derive(fetched);
      const plan = planSave(groups, work.selection);
      work = { ...work, ...applySaveResults(work, results(plan.body), 'HAR-51', { body: plan.body }) };
      return plan;
    },
    pending(fetched) {
      return bodySize(planSave(derive(fetched).groups, work.selection).body);
    },
  };
}

describe('a Save is one Save', () => {
  it('keeps the Machinery a student chose on a new Part, with nothing left to save', () => {
    const s = session({
      preview: { newParts: [item('VR27P-1102A', 'Gusset')], existingParts: [] },
      edits: { 'VR27P-1102A': { machinery: 'CNC Mill' } },
      selection: ['VR27P-1102A'],
    });
    const plan = s.save([], () => [{ ref: 'VR27P-1102A', op: 'create', ok: true, key: 'HAR-3000', linked: true }]);
    expect(plan.body.creates[0].machinery).toBe('CNC Mill');

    const row = s.derive([]).groups.inBuild[0];
    expect(row.values.machinery).toBe('CNC Mill');
    expect(row.dirty).toBe(false);
    expect(s.pending([])).toBe(0);
  });

  it('does not touch what the student chose when CAD is read again', () => {
    const part = { ...item('VR27P-1101A', 'Tube'), key: 'HAR-10', machinery: 'CNC Mill', powdercoat: 'Black', thickness: '0.125' };
    const s = session({
      parts: [part],
      linked: ['HAR-10'],
      preview: { newParts: [], existingParts: [{ story: part, bomItem: item('VR27P-1101A', 'Tube'), changes: { count: 0 } }] },
      selection: [],
    });
    const row = s.derive([part]).groups.inBuild[0];
    expect(row).toMatchObject({ changedInCad: false, dirty: false });
    expect(row.values).toMatchObject({ machinery: 'CNC Mill', powdercoat: 'Black', thickness: '0.125' });
  });

  it('still follows CAD for quantity and material', () => {
    const part = { ...item('VR27P-1101A', 'Tube'), key: 'HAR-10' };
    const s = session({
      parts: [part],
      linked: ['HAR-10'],
      preview: { newParts: [], existingParts: [{ story: part, bomItem: item('VR27P-1101A', 'Tube', { quantity: 5, material: 'AL 7075' }), changes: { count: 2 } }] },
      selection: [],
    });
    const row = s.derive([part]).groups.inBuild[0];
    expect(row.changedInCad).toBe(true);
    expect(row.values).toMatchObject({ quantity: 5, material: 'AL 7075' });
    const plan = s.save([part], (body) => body.updates.map((u) => ({ ref: u.ref, op: 'update', ok: true, key: u.key })));
    expect(plan.body.updates[0]).toMatchObject({ key: 'HAR-10', quantity: 5, material: 'AL 7075' });
  });
});

describe('Builds that reuse Parts from a cut Build', () => {
  const cutBuild = { key: 'HAR-50', buildNumber: 1, status: 'Active' };
  const draft = { key: 'HAR-51', buildNumber: 2, status: 'Draft' };
  const made = { ...item('VR27P-1101A', 'Tube'), key: 'HAR-10', ...VALUES };

  function build2({ reused, cadQuantity, preview }) {
    const links = new Map([['HAR-50', ['HAR-10']], ['HAR-51', reused ? ['HAR-10'] : []]]);
    let work = { edits: {}, createdKeys: {}, linkedThisSession: new Map(), unlinkedThisSession: new Map(), selection: new Set(), rowResults: {} };
    const derive = (parts, createdParts) => deriveDesignerRows({
      parts, createdParts, chainKeys: ['HAR-1'], linkedByPart: linksFromBuildParts(links),
      linkedThisSession: work.linkedThisSession, unlinkedThisSession: work.unlinkedThisSession, buildKey: 'HAR-51',
      builds: [cutBuild, draft],
      preview: preview ?? { newParts: [], existingParts: [{ story: made, bomItem: item('VR27P-1101A', 'Tube', { quantity: cadQuantity }), changes: { count: 0 } }] },
      edits: work.edits, createdKeys: work.createdKeys, rowResults: work.rowResults,
    });
    return {
      derive,
      get work() { return work; },
      select(ids) { work = { ...work, selection: new Set(ids) }; },
      save(parts, results) {
        const { groups } = derive(parts);
        const plan = planSave(groups, work.selection);
        work = { ...work, ...applySaveResults(work, results(plan.body), 'HAR-51', { body: plan.body }) };
        return plan;
      },
    };
  }

  it('makes only the missing unit when the Build reuses the Part and CAD now needs 3', () => {
    const s = build2({ reused: true, cadQuantity: 3 });
    const rows = s.derive([made]).groups;
    expect(rows.inBuild.map((r) => r.key)).toEqual(['HAR-10']);
    expect(rows.newFromCad).toHaveLength(1);
    expect(rows.newFromCad[0]).toMatchObject({ isCopy: true, copyOf: 'HAR-10', values: expect.objectContaining({ quantity: 1 }) });

    s.select(['copy:HAR-10']);
    const copyPart = { ...made, key: 'HAR-3000', quantity: 1 };
    const plan = s.save([made], () => [
      { ref: 'copy:HAR-10', op: 'copy', ok: true, key: 'HAR-3000', linked: true, part: copyPart },
    ]);
    expect(plan.body.copies).toEqual([{ ref: 'copy:HAR-10', from: 'HAR-10', quantity: 1 }]);

    const after = s.derive([made], new Map([['HAR-3000', copyPart]])).groups;
    expect(after.newFromCad).toEqual([]);
    expect(after.inBuild.map((r) => r.key).sort()).toEqual(['HAR-10', 'HAR-3000']);
    expect(bodySize(planSave(after, s.work.selection).body)).toBe(0);
  });

  it('makes all 3 when the Build does not reuse the Part', () => {
    const s = build2({ reused: false, cadQuantity: 3 });
    const rows = s.derive([made]).groups;
    expect(rows.inBuild).toEqual([]);
    expect(rows.other).toEqual([]);
    expect(rows.newFromCad[0]).toMatchObject({ isCopy: true, values: expect.objectContaining({ quantity: 3 }) });
    expect(rows.newFromCad[0].revisionNote.text).toBe('Make 3 new.');
  });

  it('needs nothing more when the Build already holds enough', () => {
    expect(build2({ reused: true, cadQuantity: 2 }).derive([made]).groups.newFromCad).toEqual([]);
  });

  it('swaps a changed Part for its new Revision in one Save', () => {
    const revision = {
      ...item('VR27P-1101B', 'Tube', { quantity: 2, version: 'B' }),
      revises: 'HAR-10', replaces: { key: 'HAR-10', fullPartNumber: 'VR27P-1101A', version: 'A' },
    };
    const s = build2({ reused: true, preview: { newParts: [revision], existingParts: [], baseline: { buildKey: 'HAR-50', buildNumber: 1 } } });
    const before = s.derive([made]).groups;
    expect(before.inBuild[0].revisionNote.text).toBe('Replaced by Revision B when you Save.');
    expect(before.newFromCad[0].revisionNote.text).toBe('Design changed since Build 1: Revision B replaces Revision A.');
    // A is cut-locked and reused, so CAD's quantity never asks for a copy of it.
    expect(before.newFromCad.filter((r) => r.isCopy)).toEqual([]);

    s.select(['VR27P-1101B']);
    const plan = s.save([made], () => [
      { ref: 'VR27P-1101B', op: 'create', ok: true, key: 'HAR-3000', linked: true, replaced: 'HAR-10' },
    ]);
    expect(plan.body.creates[0]).toMatchObject({ ref: 'VR27P-1101B', revises: 'HAR-10' });

    const after = s.derive([made]).groups;
    expect(after.inBuild.map((r) => r.key)).toEqual(['HAR-3000']);
    expect(bodySize(planSave(after, s.work.selection).body)).toBe(0);
  });
});

describe('which ticket a row shows a picture from', () => {
  const original = { ...item('VR27P-1101A', 'Tube'), key: 'HAR-10', ...VALUES };
  const spare = { ...original, key: 'HAR-20' };
  const derive = (extra = {}) => deriveDesignerRows({
    parts: [spare, original], chainKeys: ['HAR-1'], linkedByPart: linksFromBuildParts(new Map([['HAR-51', ['HAR-10', 'HAR-20']]])),
    linkedThisSession: new Map(), buildKey: 'HAR-51', builds: [{ key: 'HAR-51', buildNumber: 1, status: 'Draft' }], ...extra,
  }).groups;

  it('shows a spare the picture of its original, whose ticket holds the files', () => {
    const rows = derive().inBuild;
    expect(Object.fromEntries(rows.map((r) => [r.key, r.imageKey]))).toEqual({ 'HAR-10': 'HAR-10', 'HAR-20': 'HAR-10' });
  });

  it('has no picture yet for a Part that is not made', () => {
    const groups = derive({ preview: { newParts: [item('VR27P-1109A', 'Gusset')], existingParts: [] } });
    expect(groups.newFromCad[0].imageKey).toBeNull();
  });
});
