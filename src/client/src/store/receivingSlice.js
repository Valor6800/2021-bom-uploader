/**
 * Receiving slice — checking parts in as they arrive.
 *
 * There is no multi-select here on purpose. Receiving happens one part at a
 * time, with the part in your hand: search for it, hit its button, move on.
 * `deliveringId` is the only transient state worth tracking, so the row being
 * written can show progress while the others are locked out.
 */

export const createReceivingSlice = (set) => ({
  /** Raw payload from GET /api/receiving. */
  receiving: null,
  receivingLoading: false,
  receivingError: null,

  /** Ticket id currently being received, or null. */
  deliveringId: null,

  /** Outcome of the most recent receive. */
  checkInResult: null,
  checkInError: null,

  /** Result of the most recent manual sync. */
  syncResult: null,
  syncing: false,

  /** Free-text search across part number, item, ticket, vendor, person, assembly. */
  search: '',

  /** 'vendor' | 'person' | 'assembly' — how the list is grouped. */
  groupBy: 'vendor',

  setSearch: (search) => set({ search }),
  setGroupBy: (groupBy) => set({ groupBy }),

  setReceivingLoading: (receivingLoading) => set({ receivingLoading }),
  setReceivingError: (receivingError) => set({ receivingError, receivingLoading: false }),
  setReceiving: (receiving) =>
    set({ receiving, receivingLoading: false, receivingError: null }),

  setDeliveringId: (deliveringId) => set({ deliveringId }),
  setCheckInResult: (checkInResult) => set({ checkInResult, checkInError: null }),
  setCheckInError: (checkInError) => set({ checkInError }),

  setSyncing: (syncing) => set({ syncing }),
  setSyncResult: (syncResult) => set({ syncResult, syncing: false }),
});
