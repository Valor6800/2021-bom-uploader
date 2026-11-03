import { planSave, applySaveResults, batchBody, saveCounts, bodySize } from '../../src/client/src/lib/designerSave.js';
import { deriveDesignerRows, linksFromBuildParts } from '../../src/client/src/lib/designerRows.js';

const part = (key, number, name, extra = {}) => {
  const m = /^V([RF])(\d{2})P-(\d{4})([A-Z])$/.exec(number);
  return {
    key, summary: `${number} ${name}`, fullPartNumber: number, seasonType: m[1], year: m[2],
    partNumber: m[3], version: m[4], name, isEpic: false, epic: 'HAR-2030',
    quantity: 1, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None',
    ...extra,
  };
};
const bomItem = (number, name, extra = {}) => {
  const { key, ...rest } = part('X', number, name, extra);
  return rest;
};

const P31 = part('HAR-2031', 'VF27P-0001A', 'Test Part');
const P32 = part('HAR-2032', 'VF27P-0002A', 'Plate');

function rows({ parts = [P31, P32], linked = [], preview = null, ...state } = {}) {
  return deriveDesignerRows({
    parts,
    chainKeys: ['HAR-2030'],
    linkedByPart: linksFromBuildParts(new Map([['HAR-2051', linked]])),
    linkedThisSession: state.linkedThisSession ?? new Map(),
    buildKey: 'HAR-2051',
    preview,
    edits: state.edits ?? {},
    createdKeys: state.createdKeys ?? {},
    rowResults: state.rowResults ?? {},
  }).groups;
}

const emptyState = () => ({
  edits: {}, createdKeys: {}, linkedThisSession: new Map(), selection: new Set(), rowResults: {},
});

describe('planSave', () => {
  it('sends a part the tool numbers by its cadRef, with the number it showed', () => {
    const row = {
      rowId: 'VF27P-0009A', isNew: true, group: 'new', summary: 'VF27P-0009A Gusset', revision: 'A',
      cadRef: 'd:e:JVD:', values: { quantity: 2, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' },
    };
    const { body } = planSave({ newFromCad: [row], inBuild: [], other: [] }, new Set(['VF27P-0009A']));
    expect(body.creates).toEqual([expect.objectContaining({
      ref: 'VF27P-0009A', summary: 'VF27P-0009A Gusset', revision: 'A', cadRef: 'd:e:JVD:',
    })]);
  });

  it('links HAR-2031 with a single link operation', () => {
    const { body, heldBack } = planSave(rows(), new Set(['HAR-2031']));
    expect(body).toEqual({ creates: [], updates: [], links: [{ ref: 'HAR-2031', key: 'HAR-2031' }], copies: [] });
    expect(heldBack).toEqual([]);
  });

  it('plans nothing for an unchanged row', () => {
    const { body } = planSave(rows({ linked: ['HAR-2031'] }), new Set());
    expect(bodySize(body)).toBe(0);
  });

  it('plans updates only for edited in-Build rows', () => {
    const { body } = planSave(rows({ linked: ['HAR-2031', 'HAR-2032'], edits: { 'HAR-2031': { quantity: 3 } } }), new Set());
    expect(body.creates).toEqual([]);
    expect(body.links).toEqual([]);
    expect(body.updates).toEqual([{
      ref: 'HAR-2031', key: 'HAR-2031', quantity: 3, material: 'PLA', machinery: '3D Printer',
      powdercoat: 'None', thickness: 'None', link: false,
    }]);
  });

  it('marks an edited, selected Other row as update with link', () => {
    const { body } = planSave(rows({ edits: { 'HAR-2032': { quantity: 2 } } }), new Set(['HAR-2032']));
    expect(body.updates[0]).toMatchObject({ key: 'HAR-2032', link: true });
    expect(saveCounts(body)).toEqual({ creates: 0, updates: 1, added: 1 });
  });

  it('holds back an unmapped material row with an error, and still plans the others', () => {
    const preview = {
      newParts: [
        bomItem('VF27P-0004A', 'Spacer', { quantity: 4, material: 'PETG-CF' }),
        bomItem('VF27P-0006A', 'Shaft', { material: 'Steel', machinery: 'Manual Lathe' }),
      ],
      existingParts: [],
    };
    const { body, heldBack } = planSave(rows({ preview }), new Set(['VF27P-0004A', 'VF27P-0006A']));
    expect(body.creates.map((c) => c.ref)).toEqual(['VF27P-0004A']);
    expect(body.creates[0]).toMatchObject({ summary: 'VF27P-0004A Spacer', revision: 'A', quantity: 4, material: 'PETG-CF' });
    expect(heldBack).toEqual([{ rowId: 'VF27P-0006A', field: 'material', error: '"Steel" isn\'t on the material list. Change the material in OnShape.' }]);
  });

  it('holds back a Revision that disagrees with the number', () => {
    const groups = { newFromCad: [{ ...rows({ preview: { newParts: [bomItem('VF27P-0004A', 'Spacer')], existingParts: [] } }).newFromCad[0], revision: 'B' }], inBuild: [], other: [] };
    const { body, heldBack } = planSave(groups, new Set(['VF27P-0004A']));
    expect(body.creates).toEqual([]);
    expect(heldBack[0]).toMatchObject({ rowId: 'VF27P-0004A', field: 'revision' });
  });

  it('keeps edits across a second Update from CAD', () => {
    const preview = { newParts: [bomItem('VF27P-0004A', 'Spacer')], existingParts: [] };
    const edits = { 'VF27P-0004A': { quantity: 7 } };
    const again = { newParts: [bomItem('VF27P-0004A', 'Spacer', { quantity: 2 })], existingParts: [] };
    expect(planSave(rows({ preview, edits }), new Set(['VF27P-0004A'])).body.creates[0].quantity).toBe(7);
    expect(planSave(rows({ preview: again, edits }), new Set(['VF27P-0004A'])).body.creates[0].quantity).toBe(7);
  });

  it('plans one row only for a Retry', () => {
    const { body } = planSave(rows(), new Set(['HAR-2031', 'HAR-2032']), { only: new Set(['HAR-2032']) });
    expect(body.links).toEqual([{ ref: 'HAR-2032', key: 'HAR-2032' }]);
  });
});

describe('applySaveResults', () => {
  it('adds a link result for HAR-2031 to the saved Build', () => {
    const body = { creates: [], updates: [], links: [{ ref: 'HAR-2031', key: 'HAR-2031' }] };
    const state = { ...emptyState(), selection: new Set(['HAR-2031']) };
    const next = applySaveResults(state, [{ ref: 'HAR-2031', op: 'link', ok: true, key: 'HAR-2031', linked: true, alreadyLinked: false }], 'HAR-2051', { body });
    expect([...next.linkedThisSession.get('HAR-2051')]).toEqual(['HAR-2031']);
    expect(next.selection.has('HAR-2031')).toBe(false);
    expect(rows({ linkedThisSession: next.linkedThisSession }).inBuild.map((r) => r.key)).toEqual(['HAR-2031']);
  });

  it('turns a create whose link failed into a link-only retry', () => {
    const preview = { newParts: [bomItem('VF27P-0004A', 'Spacer', { quantity: 4, material: 'PETG-CF' })], existingParts: [] };
    const selection = new Set(['VF27P-0004A']);
    const first = planSave(rows({ preview }), selection);
    expect(first.body.creates).toHaveLength(1);

    const next = applySaveResults({ ...emptyState(), selection }, [{
      ref: 'VF27P-0004A', op: 'create', ok: false, key: 'HAR-2034', reused: false, updated: false,
      linked: false, error: "Created, but not added to Build 1: the team tracker didn't respond (503)",
      status: 503, source: 'tracker',
    }], 'HAR-2051', { body: first.body });
    expect(next.createdKeys).toEqual({ 'VF27P-0004A': 'HAR-2034' });
    expect(next.selection.has('HAR-2034')).toBe(true);
    expect(next.rowResults['HAR-2034']).toMatchObject({ ok: false });

    const groups = rows({ preview, ...next });
    const retry = planSave(groups, next.selection, { only: new Set(['HAR-2034']) });
    expect(retry.body).toEqual({ creates: [], updates: [], links: [{ ref: 'HAR-2034', key: 'HAR-2034' }], copies: [] });
  });

  it('notes a reused create that was updated', () => {
    const body = { creates: [{ ref: 'VF27P-0001A', summary: 'VF27P-0001A Test Part', quantity: 3, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' }], updates: [], links: [] };
    const next = applySaveResults(emptyState(), [{ ref: 'VF27P-0001A', op: 'create', ok: true, key: 'HAR-2031', reused: true, updated: true, linked: true }], 'HAR-2051', { body, buildName: 'Build 1' });
    expect(next.rowResults['HAR-2031'].note).toBe('Already existed; updated and added to Build 1.');
  });

  it('keeps edits on a failed update', () => {
    const state = { ...emptyState(), edits: { 'HAR-2031': { quantity: 3 } } };
    const next = applySaveResults(state, [{ ref: 'HAR-2031', op: 'update', ok: false, key: 'HAR-2031', field: 'material', error: 'x' }], 'HAR-2051');
    expect(next.edits['HAR-2031']).toEqual({ quantity: 3 });
    expect(next.rowResults['HAR-2031']).toMatchObject({ ok: false, field: 'material' });
  });
});

describe('batchBody', () => {
  it('splits 60 items into 25, 25 and 10 with every ref once', () => {
    const body = {
      creates: Array.from({ length: 30 }, (_, i) => ({ ref: `c${i}` })),
      updates: Array.from({ length: 20 }, (_, i) => ({ ref: `u${i}` })),
      links: Array.from({ length: 10 }, (_, i) => ({ ref: `l${i}` })),
    };
    const batches = batchBody(body, 25);
    expect(batches.map(bodySize)).toEqual([25, 25, 10]);
    const refs = batches.flatMap((b) => [...b.creates, ...b.updates, ...b.links].map((i) => i.ref));
    expect(refs).toEqual([...body.creates, ...body.updates, ...body.links].map((i) => i.ref));
    expect(batches[0].creates).toHaveLength(25);
    expect(batches[1].creates).toHaveLength(5);
    expect(batches[1].updates).toHaveLength(20);
  });
});

describe('planSave with a Part a cut Build uses', () => {
  it('sends a ticked locked row as a link only, never as an update', () => {
    const row = {
      rowId: 'HAR-2033', key: 'HAR-2033', group: 'other', readOnly: false, sharedLocked: true, dirty: false,
      values: { quantity: 1, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' },
    };
    const { body } = planSave({ newFromCad: [], inBuild: [], other: [row] }, new Set(['HAR-2033']));
    expect(body).toEqual({ creates: [], updates: [], links: [{ ref: 'HAR-2033', key: 'HAR-2033' }], copies: [] });
  });
});

describe('Priority in a save', () => {
  const P31p = { ...P31, priority: 'High' };

  it('sends no priority when it is untouched, so saves work before the field is on the tracker screen', () => {
    const groups = rows({ parts: [P31p, P32], linked: ['HAR-2031', 'HAR-2032'], edits: { 'HAR-2031': { quantity: 3 } } });
    const { body } = planSave(groups, new Set());
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0]).toMatchObject({ key: 'HAR-2031', quantity: 3 });
    expect(body.updates[0]).not.toHaveProperty('priority');
  });

  it('sends the priority when it changed', () => {
    const groups = rows({ parts: [P31p, P32], linked: ['HAR-2031', 'HAR-2032'], edits: { 'HAR-2031': { priority: 'Low' } } });
    const { body } = planSave(groups, new Set());
    expect(body.updates[0]).toMatchObject({ key: 'HAR-2031', priority: 'Low' });
  });

  it('sends a priority picked on a New row, and none otherwise', () => {
    const preview = { newParts: [bomItem('VF27P-0004A', 'Spacer'), bomItem('VF27P-0005A', 'Gusset')], existingParts: [] };
    const groups = rows({ preview, edits: { 'VF27P-0004A': { priority: 'Highest' } } });
    const { body } = planSave(groups, new Set(['VF27P-0004A', 'VF27P-0005A']));
    const byRef = Object.fromEntries(body.creates.map((c) => [c.ref, c]));
    expect(byRef['VF27P-0004A'].priority).toBe('Highest');
    expect(byRef['VF27P-0005A']).not.toHaveProperty('priority');
  });

  it('holds back an unlisted priority before Save', () => {
    const groups = rows({ parts: [P31p, P32], linked: ['HAR-2031'], edits: { 'HAR-2031': { priority: 'Urgent' } } });
    const { body, heldBack } = planSave(groups, new Set());
    expect(body.updates).toEqual([]);
    expect(heldBack[0]).toMatchObject({ rowId: 'HAR-2031', field: 'priority' });
  });

  it('remembers the written priority after a save', () => {
    const state = emptyState();
    const body = { creates: [], updates: [{ ref: 'HAR-2031', key: 'HAR-2031', quantity: 1, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None', priority: 'Low' }], links: [] };
    const next = applySaveResults(state, [{ ref: 'HAR-2031', op: 'update', ok: true, key: 'HAR-2031' }], 'HAR-2051', { body });
    expect(next.rowResults['HAR-2031'].values.priority).toBe('Low');
  });
});
