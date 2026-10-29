import { fetchBuildsForAssembly, fetchBuildParts } from '../api/client.js';

/**
 * Build slice — the selected Build within an Assembly (Designer tab) and the
 * Part keys currently linked to it.
 *
 * Slice factory pattern, same as assemblySlice.js: a function of (set, get)
 * returning its slice of state + actions, composed in store/index.js.
 */
export const createBuildSlice = (set, get) => ({
  builds: [],
  buildsLoading: false,
  selectedBuild: null,

  /** Bump to force BuildSelection to reload its build dropdown. */
  buildReloadKey: 0,

  /** Part keys ("Used In") currently linked to the selected Build. */
  buildParts: [],
  buildPartsLoading: false,

  setBuilds: (builds) => set({ builds }),

  /** Select a Build and load its linked parts. Passing `null` clears both. */
  selectBuild: (build) => {
    set({ selectedBuild: build });
    get().reloadBuildParts();
  },

  /** Signal that a new Build was created so the dropdown reloads. */
  markBuildCreated: () =>
    set((state) => ({ buildReloadKey: state.buildReloadKey + 1 })),

  /** Load every Build under an Assembly's revision chain into the store. */
  loadBuildsForAssembly: async (assemblyKey, revisionChainKeys) => {
    if (!assemblyKey) {
      set({ builds: [] });
      return;
    }
    set({ buildsLoading: true });
    try {
      const builds = await fetchBuildsForAssembly(assemblyKey, revisionChainKeys);
      set({ builds });
    } finally {
      set({ buildsLoading: false });
    }
  },

  /** Reload the linked-part keys for the currently selected Build. */
  reloadBuildParts: async () => {
    const build = get().selectedBuild;
    if (!build?.key) {
      set({ buildParts: [] });
      return;
    }
    set({ buildPartsLoading: true });
    try {
      const parts = await fetchBuildParts(build.key);
      set({ buildParts: Array.isArray(parts) ? parts : [] });
    } finally {
      set({ buildPartsLoading: false });
    }
  },
});
