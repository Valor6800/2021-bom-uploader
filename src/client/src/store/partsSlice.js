/**
 * Parts slice — the central shared parts/stories list plus loading state.
 *
 * `stories` is the array shared between the selection flow (which populates it)
 * and the parts table (which edits and saves it). `setStories` accepts either a
 * new array or a functional updater, matching React's setState semantics so
 * callers can do fine-grained row updates.
 */
export const createPartsSlice = (set) => ({
  stories: [],
  loading: false,

  setLoading: (loading) => set({ loading }),

  /**
   * Replace the stories list. Accepts an array or an updater fn (prev) => next.
   */
  setStories: (storiesOrUpdater) =>
    set((state) => ({
      stories:
        typeof storiesOrUpdater === 'function'
          ? storiesOrUpdater(state.stories)
          : storiesOrUpdater,
    })),

  /** Update a single story row by index, merging in the given fields. */
  updateStoryAt: (idx, fields) =>
    set((state) => {
      const updated = [...state.stories];
      if (!updated[idx]) return {};
      updated[idx] = { ...updated[idx], ...fields };
      return { stories: updated };
    }),
});
