import { fetchStoriesByEpic } from '../api/client.js';

/**
 * Assembly slice — the OnShape/Jira assembly selection context: architecture
 * (seasonType), model year, and the currently selected epic (assembly).
 *
 * Slice factory pattern: each slice is a function of (set, get) returning its
 * slice of state + actions, composed in store/index.js. This keeps domains
 * modular and lets new domains (e.g. exports, documents) be added the same way.
 */
export const createAssemblySlice = (set, get) => ({
  seasonType: 'R',
  year: '26',
  selectedEpic: null,

  /** Bump to force AssemblySelection to reload its epic dropdown. */
  epicReloadKey: 0,

  setSeasonType: (seasonType) => set({ seasonType }),
  setYear: (year) => set({ year }),

  /**
   * Select an epic and load its stories into the parts slice.
   * Passing `null` clears the selection and the stories list.
   */
  selectEpic: (epic, loadedStories = []) => {
    set({ selectedEpic: epic });
    get().setStories(loadedStories);
  },

  /** Signal that a new epic was created so the dropdown reloads. */
  markEpicCreated: () =>
    set((state) => ({ epicReloadKey: state.epicReloadKey + 1 })),

  /** Reload fresh stories for the selected epic from Jira (post-save). */
  reloadSelectedEpicStories: async () => {
    const epic = get().selectedEpic;
    if (!epic?.key) return;
    try {
      const fresh = await fetchStoriesByEpic(epic.key);
      const list = Array.isArray(fresh) ? fresh : Object.values(fresh);
      get().setStories(list.map((s) => ({ ...s, _status: 'Exists' })));
    } catch {
      // Keep current state if reload fails.
    }
  },
});
