/**
 * Row choices come back from the server's saved order, which may have gone out
 * of date since it was saved.
 */
import { createPurchasingSlice } from '../../src/client/src/store/purchasingSlice.js';

/** Just enough of a Zustand store to drive the slice. */
function makeStore() {
  const store = {
    state: null,
    set: (update) => {
      const patch = typeof update === 'function' ? update(store.state) : update;
      store.state = { ...store.state, ...patch };
    },
  };
  store.state = createPurchasingSlice(store.set, () => store.state);
  return store;
}

const line = (key, fields = {}) => ({ key, classification: 'Robot', blocked: false, ...fields });

const queue = (items, draft) => ({
  vendorGroups: [{ vendor: 'Rev', items }],
  wishList: [{ wishId: 0, item: 'Hardware' }, { wishId: 3, item: 'Spares' }],
  options: { classifications: ['Robot', 'Game'] },
  draft,
});

describe('setQueue', () => {
  it('gives a row with nothing saved its defaults', () => {
    const store = makeStore();

    store.state.setQueue(queue([line('PARTS-1')], {}));

    expect(store.state.selections['PARTS-1']).toEqual({
      selected: false, classification: 'Robot', wishId: null,
    });
  });

  it('restores a saved tick, Classification and bucket', () => {
    const store = makeStore();

    store.state.setQueue(queue([line('PARTS-1')], {
      'PARTS-1': { selected: true, classification: 'Game', wishId: 3 },
    }));

    expect(store.state.selections['PARTS-1']).toEqual({
      selected: true, classification: 'Game', wishId: 3,
    });
  });

  it('restores Wish ID 0, which is a real bucket', () => {
    const store = makeStore();

    store.state.setQueue(queue([line('PARTS-1')], { 'PARTS-1': { wishId: 0 } }));

    expect(store.state.selections['PARTS-1'].wishId).toBe(0);
  });

  it('does not tick a row blocked since it was saved', () => {
    const store = makeStore();

    store.state.setQueue(queue([line('PARTS-1', { blocked: true })], {
      'PARTS-1': { selected: true },
    }));

    expect(store.state.selections['PARTS-1'].selected).toBe(false);
  });

  it('drops a Classification or bucket no longer on the sheet', () => {
    const store = makeStore();

    store.state.setQueue(queue([line('PARTS-1')], {
      'PARTS-1': { selected: true, classification: 'Retired', wishId: 99 },
    }));

    expect(store.state.selections['PARTS-1']).toEqual({
      selected: true, classification: 'Robot', wishId: null,
    });
  });

  it('copes with a queue that has no saved order', () => {
    const store = makeStore();

    store.state.setQueue(queue([line('PARTS-1')], undefined));

    expect(store.state.selections['PARTS-1'].selected).toBe(false);
  });

  it('takes the server\'s word over what this browser last showed', () => {
    const store = makeStore();
    store.state.setQueue(queue([line('PARTS-1')], { 'PARTS-1': { selected: true } }));

    store.state.setQueue(queue([line('PARTS-1')], { 'PARTS-1': { selected: false } }));

    expect(store.state.selections['PARTS-1'].selected).toBe(false);
  });
});

describe('applyDraft', () => {
  it('takes on another mentor\'s changes', () => {
    const store = makeStore();
    store.state.setQueue(queue([line('PARTS-1'), line('PARTS-2')], {}));

    store.state.applyDraft({ 'PARTS-2': { selected: true, wishId: 3 } });

    expect(store.state.selections['PARTS-1'].selected).toBe(false);
    expect(store.state.selections['PARTS-2']).toEqual({
      selected: true, classification: 'Robot', wishId: 3,
    });
  });

  it('ignores saved rows for tickets not on this page', () => {
    const store = makeStore();
    store.state.setQueue(queue([line('PARTS-1')], {}));

    store.state.applyDraft({ 'PARTS-9': { selected: true } });

    expect(Object.keys(store.state.selections)).toEqual(['PARTS-1']);
  });
});
