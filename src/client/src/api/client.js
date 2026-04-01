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

export const MATERIALS = Object.values(Material);
export const MACHINERY = Object.values(MachineryEnum);
export const POWDERCOAT = Object.values(PowdercoatEnum);
export const THICKNESS = Object.values(ThicknessEnum);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Epics
// ---------------------------------------------------------------------------
export function fetchEpics(seasonType, year) {
  return request(`/api/epics?seasonType=${encodeURIComponent(seasonType)}&year=${encodeURIComponent(year)}`);
}

export function createEpicFromURL(url) {
  return request('/api/epics/from-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------
export function fetchStoriesByEpic(epicKey) {
  return request(`/api/stories?key=${encodeURIComponent(epicKey)}`);
}

export function fetchStoriesByPartNumber(partNumber) {
  return request(`/api/stories?partNumber=${encodeURIComponent(partNumber)}`);
}

export function createStory(payload) {
  return request('/api/stories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateStory(key, payload) {
  return request(`/api/stories/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// BOM
// ---------------------------------------------------------------------------
export function fetchBOM(epicKey, documentId, workspaceId, elementId) {
  const params = new URLSearchParams({ epicKey, documentId, workspaceId, elementId });
  return request(`/api/bom?${params}`);
}

// ---------------------------------------------------------------------------
// Parts preview / upload
// ---------------------------------------------------------------------------
export function previewParts(params) {
  return request('/api/parts/preview', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function uploadSelectedParts(parts) {
  return request('/api/parts/upload', {
    method: 'POST',
    body: JSON.stringify({ parts }),
  });
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
