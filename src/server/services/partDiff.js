/**
 * Part Diff — which Parts changed since the last cut Build.
 *
 * Every cut Build points at an immutable OnShape version, so "the last cut"
 * is a snapshot that never moves. A Part counts as changed when its shape (or
 * material) in the workspace differs from the same Part in that snapshot.
 *
 * The shape is a handful of numbers OnShape computes from the part's exact
 * geometry (volume, surface area, mass, principal moments of inertia). None
 * depends on where the part sits in its Part Studio, and none comes from the
 * display mesh. Two shapes are the same when every number agrees within a
 * relative tolerance (PART_DIFF_TOLERANCE, default 0.01%): loose enough to
 * ignore numeric noise (OnShape reports about 0.0002%), tight enough to catch
 * a single small hole.
 *
 * Students edit a Part Studio all the time, so the Part Studio's own version
 * id says nothing about one part. It is used only to remember a shape already
 * fetched, never to decide a part is unchanged.
 *
 * A Part that can't be checked counts as changed: an extra Revision is only
 * a ticket too many, while a missed one ships the wrong Part.
 */

import { BuildField } from '../utils/buildConstants.js';
import { baseNumber } from '../utils/partChain.js';
import { isCutStatus } from '../utils/cutBuilds.js';
import { sanitizeJQL } from '../utils/validators.js';

const JIRA_PROJECT = () => process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';
const VERSION_LINK_RE = /\/documents\/([a-f0-9]{24})\/v\/([a-f0-9]{24})\/e\/([a-f0-9]{24})/i;

const DEFAULT_TOLERANCE = 1e-4;
const BATCH = 8;

/** The relative difference below which two shapes are the same (PART_DIFF_TOLERANCE). */
export function diffTolerance() {
  const value = Number(process.env.PART_DIFF_TOLERANCE);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TOLERANCE;
}

/**
 * True when two shapes (from `getPartShape`) agree within the tolerance, as a
 * fraction of the larger of each pair of numbers.
 */
export function sameShape(a, b, tolerance = diffTolerance()) {
  const close = (x, y) => {
    const scale = Math.max(Math.abs(x), Math.abs(y));
    return scale === 0 || Math.abs(x - y) <= tolerance * scale;
  };
  const pairs = [
    [a.volume, b.volume], [a.periphery, b.periphery], [a.mass, b.mass],
    ...a.principalInertia.map((v, i) => [v, b.principalInertia[i] ?? NaN]),
  ];
  return a.principalInertia.length === b.principalInertia.length && pairs.every(([x, y]) => close(x, y));
}

/** What identifies one part's shape in one place, so it is fetched once. */
function shapeKey(origin) {
  return [origin.wvmType, origin.wvmId, origin.elementId, origin.partId, origin.configuration ?? '',
    // A workspace changes under us; its Part Studio version id says when.
    origin.wvmType === 'w' ? origin.microversionId : ''].join(':');
}

export class PartDiff {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   * @param {import('./bomService.js').BOMService} deps.bomService
   */
  constructor({ jiraClient, onshapeClient, bomService }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.bomService = bomService;
    /** shapeKey -> shape. A cut version never changes; a workspace is keyed by its version id. */
    this._shapes = new Map();
  }

  /**
   * `getPartShape`, remembered. Caches the in-flight promise (not the
   * resolved shape), so two parts compared at once that share an origin
   * never fire the request twice.
   */
  _shape(origin) {
    const cacheable = origin.wvmType === 'v' || !!origin.microversionId;
    const key = cacheable ? shapeKey(origin) : null;
    if (key && this._shapes.has(key)) return this._shapes.get(key);
    const promise = this.onshapeClient.getPartShape(origin);
    if (key) {
      this._shapes.set(key, promise);
      promise.catch(() => this._shapes.delete(key));
    }
    return promise;
  }

  /**
   * The last cut Build across an Assembly's Revision chain: the newest
   * Revision's, then the highest Build number, among cut Builds that hold an
   * OnShape version.
   *
   * @param {string[]} chainKeys  Newest Revision first
   * @returns {Promise<{ buildKey: string, buildNumber: number|null, documentId: string, versionId: string, elementId: string }|null>}
   */
  async baseline(chainKeys) {
    if (!chainKeys?.length) return null;
    const keys = chainKeys.map((k) => sanitizeJQL(k)).join(', ');
    const builds = await this.jiraClient.searchIssues(
      `project = ${JIRA_PROJECT()} AND issuetype = Build AND "Epic Link" in (${keys})`,
      { paginate: true, fields: ['status', BuildField.ASSEMBLY_LINK, BuildField.BUILD_NUMBER, BuildField.ONSHAPE_VERSION_LINK] },
    );
    const rank = new Map(chainKeys.map((key, i) => [key, i]));
    const candidates = builds
      .map((issue) => ({
        issue,
        match: VERSION_LINK_RE.exec(issue.fields?.[BuildField.ONSHAPE_VERSION_LINK] ?? ''),
      }))
      .filter(({ issue, match }) => match && isCutStatus(issue.fields?.status?.name))
      .sort((a, b) => (rank.get(a.issue.fields[BuildField.ASSEMBLY_LINK]) ?? 99)
        - (rank.get(b.issue.fields[BuildField.ASSEMBLY_LINK]) ?? 99)
        || (b.issue.fields[BuildField.BUILD_NUMBER] ?? 0) - (a.issue.fields[BuildField.BUILD_NUMBER] ?? 0));
    if (!candidates.length) return null;
    const { issue, match } = candidates[0];
    return {
      buildKey: issue.key,
      buildNumber: issue.fields[BuildField.BUILD_NUMBER] ?? null,
      documentId: match[1],
      versionId: match[2],
      elementId: match[3],
    };
  }

  /**
   * Which of the current parts differ from the same part in the baseline.
   *
   * @param {object} baseline  From `baseline`
   * @param {object[]} parts   Current BOM parts (with `origin`)
   * @param {{ seasonType?: string, year?: string }|null} assembly
   * @returns {Promise<Set<string>>}  Base numbers ("R27-1101") that changed
   */
  async changedNumbers(baseline, parts, assembly) {
    const { parts: before } = await this.bomService.getVersionReport(
      baseline.documentId, baseline.versionId, baseline.elementId, assembly,
    );
    const was = new Map(before.map((p) => [baseNumber(p), p]).filter(([n]) => n));

    const toCheck = [];
    const changed = new Set();
    for (const part of parts) {
      const number = baseNumber(part);
      const old = number ? was.get(number) : null;
      if (!old) continue;
      if (!part.origin || !old.origin) {
        changed.add(number);
      } else {
        toCheck.push({ number, part, old });
      }
    }

    for (let i = 0; i < toCheck.length; i += BATCH) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(toCheck.slice(i, i + BATCH).map(async ({ number, part, old }) => {
        if (part.material !== old.material) {
          changed.add(number);
          return;
        }
        try {
          const [now, then] = await Promise.all([
            this._shape(part.origin),
            this._shape(old.origin),
          ]);
          if (!sameShape(now, then)) changed.add(number);
        } catch (err) {
          console.warn('[diff]', number, 'could not be compared; counting it as changed:', err?.status, err?.message);
          changed.add(number);
        }
      }));
    }
    return changed;
  }
}
