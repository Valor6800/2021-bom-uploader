import { create } from 'zustand';
import { createPurchasingSlice } from './purchasingSlice.js';
import { createReceivingSlice } from './receivingSlice.js';
/**
 * Root client store. Composes per-domain slices into a single Zustand store.
 * Add a new slice factory here to extend the portal's client state.
 *
 * The BOM pages (Designer, Assembly) keep their own local state on purpose;
 * this store holds only purchasing and receiving.
 *
 * Usage: select the minimal state a component needs, e.g.
 *   const queue = useAppStore((s) => s.queue);
 */
export const useAppStore = create((set, get) => ({
  ...createPurchasingSlice(set, get),
  ...createReceivingSlice(set, get),
}));
