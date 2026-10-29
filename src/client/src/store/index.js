import { create } from 'zustand';
import { createAssemblySlice } from './assemblySlice.js';
import { createBuildSlice } from './buildSlice.js';
import { createPartsSlice } from './partsSlice.js';
import { createPurchasingSlice } from './purchasingSlice.js';
import { createReceivingSlice } from './receivingSlice.js';

/**
 * Root client store. Composes per-domain slices into a single Zustand store.
 * Add a new slice factory here to extend the portal's client state.
 *
 * Usage: select the minimal state a component needs, e.g.
 *   const stories = useAppStore((s) => s.stories);
 *   const setStories = useAppStore((s) => s.setStories);
 */
export const useAppStore = create((set, get) => ({
  ...createAssemblySlice(set, get),
  ...createPartsSlice(set, get),
  ...createPurchasingSlice(set, get),
  ...createReceivingSlice(set, get),
}));
