/**
 * Fetch-based API client for all backend endpoints.
 * Also re-exports BOM constants for dropdown options.
 */

// ---------------------------------------------------------------------------
// BOM Constants (mirrored from src/server/utils/bomConstants.js)
// ---------------------------------------------------------------------------
export const Material = Object.freeze({
  NONE: 'None',
  AL_6061: 'AL 6061',
  PLA: 'PLA',
  PETG_CF: 'PETG-CF',
  NYLON: 'Nylon',
  WOOD: 'Wood',
  POLYCARB: 'Polycarb',
  SRPP: 'SRPP',
  AL_7075: 'AL 7075',
});

export const MachineryEnum = Object.freeze({
  NONE: 'None',
  CNC_MILL: 'CNC Mill',
  CNC_ROUTER: 'CNC Router',
  MANUAL_MILL: 'Manual Mill',
  MANUAL_LATHE: 'Manual Lathe',
  THREE_D_PRINTER: '3D Printer',
  MANUAL: 'Manual',
});

export const PowdercoatEnum = Object.freeze({
  NONE: 'None',
  BLACK: 'Black',
  GOLD: 'Gold',
});

export const ThicknessEnum = Object.freeze({
  NONE: 'None',
  T_0060: '0.060',
  T_0090: '0.090',
  T_0125: '0.125',
  T_01875: '0.1875',
  T_0250: '0.250',
});

/** Mirrors PRIORITIES in the server's bomConstants.js, highest first. */
export const PRIORITIES = Object.freeze(['Highest', 'High', 'Medium', 'Low', 'Lowest']);

export const MATERIALS = Object.values(Material);
export const MACHINERY = Object.values(MachineryEnum);
export const POWDERCOAT = Object.values(PowdercoatEnum);
export const THICKNESS = Object.values(ThicknessEnum);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Thrown when an endpoint needs a signed-in mentor.
 *
 * Carried as a distinct type because the UI response is different in kind: not
 * "something went wrong" but "sign in to continue". A client-side navigation
 * into a gated page never asks the server for a document, so this is the first
 * point at which the app learns it needs a session.
 */
export class AuthRequiredError extends Error {
  constructor(message, { loginUrl, forbidden = false }) {
    super(message);
    this.name = 'AuthRequiredError';
    this.authRequired = true;
    this.forbidden = forbidden;
    this.loginUrl = loginUrl ?? '/auth/login';
  }
}

/**
 * Thrown for every non-OK response other than ValorBOM's own 401/403. Carries the HTTP status
 * and the parsed JSON body, so callers (and lib/friendlyError.js) can read the
 * server's `source`, per-item details or `buildStatus` without parsing text.
 */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Thrown when fetch() itself fails: the ValorBOM server could not be reached
 * (down, restarting, offline). Kept apart from errors in our own code so the
 * UI only says "couldn't reach ValorBOM" when that is what happened.
 */
export class NetworkError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      // Send the session cookie; harmless same-origin, required if ever not.
      credentials: 'same-origin',
      ...options,
    });
  } catch (err) {
    // A cancelled request is not a failure; callers check for AbortError.
    if (err?.name === 'AbortError') throw err;
    throw new NetworkError("Couldn't reach ValorBOM", { cause: err });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    // A 401/403 that names a `source` is the tracker or OnShape refusing,
    // not ValorBOM's own sign-in gate.
    if ((res.status === 401 || res.status === 403) && !body.source) {
      throw new AuthRequiredError(
        body.error || 'Sign-in required',
        { loginUrl: body.loginUrl, forbidden: res.status === 403 },
      );
    }

    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status, body);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Epics
// ---------------------------------------------------------------------------
export function fetchEpicByKey(key) {
  return request(`/api/epics/${encodeURIComponent(key)}`);
}

/** Where the background file jobs for these Part tickets stand: `{ statuses: { [key]: { state, problems } } }`. */
export function fetchFileStatus(keys) {
  return request(`/api/pictures/status?keys=${keys.map(encodeURIComponent).join(',')}`);
}

/** The Assembly's off-the-shelf parts (vendor rows from other OnShape documents) for a Build. */
export function fetchPurchasedParts(key, buildKey) {
  const query = buildKey ? `?build=${encodeURIComponent(buildKey)}` : '';
  return request(`/api/epics/${encodeURIComponent(key)}/purchased-parts${query}`);
}

/** The Assembly's sub-assemblies (from its OnShape BOM), each matched to its own Assembly where one exists. */
export function fetchSubAssemblies(key) {
  return request(`/api/epics/${encodeURIComponent(key)}/sub-assemblies`);
}

/**
 * Search Assemblies by key, name, number, season or year.
 * @param {string} q
 * @param {{ limit?: number, includeClosed?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<{ results: object[], total: number, groups: object[] }>}
 */
export function searchAssemblies(q, { limit, includeClosed = false, signal } = {}) {
  const params = new URLSearchParams({ q: q ?? '' });
  if (limit !== undefined) params.set('limit', String(limit));
  if (includeClosed) params.set('includeClosed', '1');
  return request(`/api/epics/search?${params}`, { signal });
}

/** Read-only check of a pasted OnShape link before onboarding it. */
export function previewOnboarding(url) {
  return request('/api/epics/onboard/preview', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

/**
 * Create the Assembly for an OnShape link, plus its Build 1.
 * @param {{ url: string, expectedSummary: string }} payload
 */
export function onboardAssembly(payload) {
  return request('/api/epics/onboard', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------
export function fetchRevisionChain(key) {
  return request(`/api/revisions/chain/${encodeURIComponent(key)}`);
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------
export function fetchStoriesByEpic(epicKey) {
  return request(`/api/stories?key=${encodeURIComponent(epicKey)}`);
}

/** Every Part under the Assembly's whole Revision chain. */
export function fetchChainParts(key) {
  return request(`/api/stories?key=${encodeURIComponent(key)}&chain=1`);
}

export function fetchStoriesByPartNumber(partNumber) {
  return request(`/api/stories?partNumber=${encodeURIComponent(partNumber)}`);
}

export function updateStory(key, payload) {
  return request(`/api/stories/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** Bulk fetch for rendering a per-build BOM, where BuildService only knows linked part keys. */
export function fetchPartsByKeys(keys) {
  if (!keys?.length) return Promise.resolve([]);
  return request(`/api/parts/by-keys?keys=${encodeURIComponent(keys.join(','))}`);
}

/** "Create spare": an exact copy of sourceKey (same number and name) under epicKey, in no Build. */
export function clonePart(sourceKey, payload) {
  return request(`/api/parts/${encodeURIComponent(sourceKey)}/clone`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

/**
 * @param {string} assemblyKey
 * @param {string[]} [revisionChainKeys]  Full revision chain for continuous
 *   numbering/history; defaults server-side to just assemblyKey when omitted.
 */
export function fetchBuildsForAssembly(assemblyKey, revisionChainKeys) {
  const params = new URLSearchParams({ assemblyKey });
  if (revisionChainKeys?.length) {
    params.set('revisionChainKeys', revisionChainKeys.join(','));
  }
  return request(`/api/builds?${params}`);
}

/**
 * @param {{ assemblyKey: string, revisionChainKeys?: string[], name: string, description?: string, cloneFromBuildKey?: string }} payload
 */
export function createBuild(payload) {
  return request('/api/builds', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Build statuses read by key (search lags a status change). At most 10.
 * @param {string[]} keys
 * @returns {Promise<{ builds: { key: string, status: string, assemblyKey: string|null,
 *   onshapeVersionLink: string|null }[], missing: string[] }>}
 */
export function fetchBuildStatuses(keys) {
  return request(`/api/builds/status?keys=${encodeURIComponent(keys.join(','))}`);
}

export function fetchBuildParts(buildKey) {
  return request(`/api/builds/${encodeURIComponent(buildKey)}/parts`);
}

export function linkPartToBuild(buildKey, partKey) {
  return request(`/api/builds/${encodeURIComponent(buildKey)}/parts`, {
    method: 'POST',
    body: JSON.stringify({ partKey }),
  });
}

/**
 * Save a Build's Part changes in one request; answers per-item results.
 * @param {string} buildKey
 * @param {{ creates?: object[], updates?: object[], links?: { ref: string, key: string }[] }} body
 * @returns {Promise<{ results: object[] }>}
 */
export function saveBuildParts(buildKey, body) {
  return request(`/api/builds/${encodeURIComponent(buildKey)}/save`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Every Build a Part is linked to, newest first — the current-build indicator. */
export function fetchBuildsForPart(partKey) {
  return request(`/api/builds/for-part/${encodeURIComponent(partKey)}`);
}

/**
 * The server reads the OnShape ids from the Assembly record, so only the
 * Assembly key is sent.
 * @param {string} buildKey
 * @param {{ assemblyKey: string }} payload
 */
export function cutBuildVersion(buildKey, payload) {
  return request(`/api/builds/${encodeURIComponent(buildKey)}/cut-version`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function archiveBuild(buildKey) {
  return request(`/api/builds/${encodeURIComponent(buildKey)}/archive`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// BOM
// ---------------------------------------------------------------------------
export function fetchBOM(epicKey, documentId, workspaceId, elementId) {
  const params = new URLSearchParams({ epicKey, documentId, workspaceId, elementId });
  return request(`/api/bom?${params}`);
}

// ---------------------------------------------------------------------------
// Parts preview
// ---------------------------------------------------------------------------
/**
 * @param {{ epicKey: string, documentId: string, workspaceId: string, elementId: string, fresh?: boolean }} params
 *   `fresh: true` skips the server's short BOM cache (Update from CAD).
 */
export function previewParts(params) {
  return request('/api/parts/preview', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------

/** Mentor-approved queue: vendor groups, anomaly flags, budget, Wish-List. */
export function fetchPurchasingQueue() {
  return request('/api/purchasing/queue');
}

/**
 * Resolve target sheet rows and projected budget without writing anything.
 * @param {{ source: string, rows: { key: string, classification: string, wishId: number|null }[] }} payload
 */
export function previewSubmission(payload) {
  return request('/api/purchasing/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Write the selected lines to the Orders sheet and move each ticket to
 * Sent to VFF.
 * @param {{ source: string, rows: { key: string, classification: string, wishId: number|null }[] }} payload
 */
export function submitPurchaseOrders(payload) {
  return request('/api/purchasing/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

/** In-flight orders grouped by vendor, matched to their sheet rows. */
export function fetchReceiving() {
  return request('/api/receiving');
}

/** Past orders from the sheet, newest first, with who each part went to. */
export function fetchOrderHistory() {
  return request('/api/receiving/history');
}

/**
 * Mark parts delivered on the sheet and in Jira.
 * @param {{ keys: string[] }} payload
 */
export function checkInDeliveries(payload) {
  return request('/api/receiving/check-in', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Pull the purchaser's sheet edits into Jira now, rather than waiting for the poll. */
export function syncFromSheet() {
  return request('/api/receiving/sync', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export function exportSTEP(params) {
  return request('/api/export/step', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function exportSTL(params) {
  return request('/api/export/stl', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ---------------------------------------------------------------------------
// Assembly guide, vendor parts, board columns (read-only)
// ---------------------------------------------------------------------------

/** The Build's build steps and kits: `{ source, steps, kit }`. */
export function fetchGuide(buildKey) {
  return request(`/api/guide/${encodeURIComponent(buildKey)}`);
}

/** A guide picture's URL (a step's sub-assembly, or a part in a step). */
export function guideImageUrl(buildKey, imageId, { large = false } = {}) {
  return `/api/guide/${encodeURIComponent(buildKey)}/image/${encodeURIComponent(imageId)}${large ? '?size=large' : ''}`;
}

/** Order tickets and vendor listings for these SKUs: `{ results: { [sku]: … } }`. */
export function lookupVendorParts(skus) {
  const unique = [...new Set(skus.filter(Boolean))].slice(0, 60);
  if (unique.length === 0) return Promise.resolve({ results: {} });
  return request(`/api/vendor/lookup?skus=${unique.map(encodeURIComponent).join(',')}`);
}

/** A vendor listing's picture URL. */
export function vendorImageUrl(sku, { large = false } = {}) {
  return `/api/vendor/image/${encodeURIComponent(sku)}${large ? '?size=large' : ''}`;
}

/** Which board column each Part status is in: `{ columns: { [statusId]: { board, column } } }`. */
export function fetchBoardColumns() {
  return request('/api/boards/columns');
}
