/**
 * OnShape call counter — a running total, persisted to disk.
 *
 * The team's OnShape plan allows a small number of API calls a year, and the
 * caches that keep calls down (bomService, assemblyGuides, partDiff, ...)
 * live in memory, so a restart forgets them. This counter is the one thing
 * that must survive a restart: it is how far through the year's budget the
 * team actually is.
 *
 * Counts every attempt (including one that fails downstream), since the
 * request still went out over the wire.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '../../../data/onshape-usage.json');

// A test run makes its own (mocked) "OnShape calls" by the hundreds; none of
// them happened for real, so they must never touch the real counter's file.
const DISABLED = process.env.NODE_ENV === 'test';

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { total: 0, since: new Date().toISOString(), byEndpoint: {}, lastAt: null };
  }
}

function write(state) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[onshape-usage] could not persist the call count:', err.message);
  }
}

let state = DISABLED ? { total: 0, since: null, byEndpoint: {}, lastAt: null } : read();

/**
 * Record one real OnShape API call. Never throws (a logging failure must
 * never break the call it is counting).
 * @param {string} endpoint  e.g. "GET /api/assemblies/d/.../bom"
 * @returns {number} the new running total
 */
export function recordOnshapeCall(endpoint) {
  if (DISABLED) return state.total;
  try {
    state.total += 1;
    state.byEndpoint[endpoint] = (state.byEndpoint[endpoint] ?? 0) + 1;
    state.lastAt = new Date().toISOString();
    write(state);
    console.log(`[onshape] call #${state.total} — ${endpoint}`);
  } catch (err) {
    console.warn('[onshape-usage] could not record a call:', err.message);
  }
  return state.total;
}

/** The running total and per-endpoint breakdown, for a status check. */
export function onshapeUsage() {
  return { ...state, byEndpoint: { ...state.byEndpoint } };
}
