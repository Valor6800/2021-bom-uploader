/**
 * Purchasing slice — the submit queue and the per-row choices the coordinator
 * makes before handing an order to the purchaser.
 *
 * `selections` is keyed by Jira issue key. A row's checkbox, Classification and
 * Wish ID are saved on the server (see useOrderDraft), so they come back with
 * the queue and are shared between mentors. `vendorSources` is keyed by
 * canonical vendor name, because a vendor order is one purchase drawn from one
 * pot of money — LISD, VFF, or nothing recorded. It lives only in this browser.
 */

/**
 * Each queue line's row choices, from what the server has saved.
 *
 * What was saved may have gone out of date since. A row blocked since it was
 * ticked comes back unticked: its checkbox is disabled, so a tick could not be
 * undone, yet would still count toward the budget. A Classification or bucket no
 * longer on the sheet is dropped, since the server would refuse it at submit.
 */
function selectionsFromDraft(queue, draft) {
  const classifications = new Set(queue?.options?.classifications ?? []);
  const wishIds = new Set((queue?.wishList ?? []).map((bucket) => bucket.wishId));
  const selections = {};

  for (const group of queue?.vendorGroups ?? []) {
    for (const line of group.items) {
      const saved = draft?.[line.key];
      selections[line.key] = {
        selected: Boolean(saved?.selected) && !line.blocked,
        classification: classifications.has(saved?.classification)
          ? saved.classification
          : line.classification,
        wishId: wishIds.has(saved?.wishId) ? saved.wishId : null,
      };
    }
  }

  return selections;
}

export const createPurchasingSlice = (set, get) => ({
  /** Raw queue payload from GET /api/purchasing/queue. */
  queue: null,
  queueLoading: false,
  queueError: null,

  /** key -> { selected, classification, wishId } */
  selections: {},

  /** Canonical vendor name -> 'LISD' | 'VFF' | '' (none recorded). */
  vendorSources: {},

  /** Submission lifecycle: 'idle' | 'previewing' | 'confirming' | 'submitting' */
  submitPhase: 'idle',
  submitPreview: null,
  submitResult: null,
  submitError: null,

  setQueueLoading: (queueLoading) => set({ queueLoading }),
  setQueueError: (queueError) => set({ queueError, queueLoading: false }),

  /**
   * Replace the queue, seeding a selection entry for every line from the order
   * saved on the server; a row with nothing saved gets its default Classification.
   */
  setQueue: (queue) =>
    set((state) => {
      const vendorSources = {};

      for (const group of queue?.vendorGroups ?? []) {
        // Blank by default — funding source should be a deliberate choice.
        vendorSources[group.vendor] = state.vendorSources[group.vendor] ?? '';
      }

      return {
        queue,
        selections: selectionsFromDraft(queue, queue?.draft),
        vendorSources,
        queueLoading: false,
        queueError: null,
      };
    }),

  /** Take on the order as saved on the server, including other mentors' changes. */
  applyDraft: (draft) =>
    set((state) => ({ selections: selectionsFromDraft(state.queue, draft) })),

  /** Set the funding source for one vendor's whole group. */
  setVendorSource: (vendor, source) =>
    set((state) => ({
      vendorSources: { ...state.vendorSources, [vendor]: source },
    })),

  /** Merge fields into one row's selection entry. */
  updateSelection: (key, fields) =>
    set((state) => ({
      selections: {
        ...state.selections,
        [key]: { ...state.selections[key], ...fields },
      },
    })),

  /**
   * Select or clear many rows at once. Blocked lines are never selected —
   * they would be rejected by the server anyway.
   *
   * @param {string[]} keys
   * @param {boolean} selected
   */
  setManySelected: (keys, selected) =>
    set((state) => {
      const blocked = new Set(
        (state.queue?.vendorGroups ?? [])
          .flatMap((g) => g.items)
          .filter((l) => l.blocked)
          .map((l) => l.key),
      );

      const selections = { ...state.selections };
      for (const key of keys) {
        if (selected && blocked.has(key)) continue;
        selections[key] = { ...selections[key], selected };
      }

      return { selections };
    }),

  clearSelections: () =>
    set((state) => {
      const selections = {};
      for (const [key, value] of Object.entries(state.selections)) {
        selections[key] = { ...value, selected: false };
      }
      return { selections };
    }),

  /** All queue lines, flattened out of their vendor groups. */
  allLines: () => (get().queue?.vendorGroups ?? []).flatMap((group) => group.items),

  /** Selected lines, merged with their per-row Classification and Wish ID. */
  selectedLines: () => {
    const { selections } = get();
    return get()
      .allLines()
      .filter((line) => selections[line.key]?.selected)
      .map((line) => ({
        ...line,
        classification: selections[line.key].classification,
        wishId: selections[line.key].wishId,
        source: get().vendorSources[line.vendor] ?? '',
      }));
  },

  setSubmitPhase: (submitPhase) => set({ submitPhase }),
  setSubmitPreview: (submitPreview) => set({ submitPreview, submitPhase: 'confirming' }),
  setSubmitResult: (submitResult) => set({ submitResult, submitPhase: 'idle' }),
  setSubmitError: (submitError) => set({ submitError, submitPhase: 'idle' }),

  resetSubmission: () =>
    set({ submitPhase: 'idle', submitPreview: null, submitResult: null, submitError: null }),
});
