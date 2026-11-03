/**
 * Cut Builds are immutable. A cut Build is any Build whose status is not
 * Draft (Active, Superseded, Archived): its Parts list never changes, and
 * neither do the fields of a Part it uses. These helpers read statuses from
 * the tracker by key at write time and build the 409s every write path uses.
 */

import { BuildField, BuildStatus, LinkType } from './buildConstants.js';
import { conflict } from '../middleware/httpError.js';

/** "Build 3", or the key when the number is missing. */
export function buildLabelOf(buildNumber, key) {
  return buildNumber != null ? `Build ${buildNumber}` : key;
}

/** True for any Build status other than Draft. */
export function isCutStatus(status) {
  return status !== BuildStatus.DRAFT;
}

/** 409 for a write into a cut Build. */
export function cutBuildConflict(label, status) {
  return conflict(
    `${label} has been cut, so it can't be changed. Make a new Build from it instead.`,
    { buildStatus: status ?? null },
  );
}

/**
 * 409 for a field update to a Part that a cut Build uses.
 *
 * @param {string} partLabel  The Part number, else its key
 * @param {{ key: string, buildNumber: number|null, status: string }[]} cutBuilds
 */
export function sharedPartConflict(partLabel, cutBuilds) {
  const labels = cutBuilds.map((b) => buildLabelOf(b.buildNumber, b.key));
  return conflict(
    `${partLabel} is used in cut ${labels.join(', ')}, so it can't be changed.`,
    { cutBuilds: cutBuilds.map(({ key, buildNumber, status }) => ({ key, buildNumber, status })) },
  );
}

/** Keys of the issues on the other side of each "Used In" link. */
export function usedInKeys(issuelinks) {
  const keys = new Set();
  for (const link of issuelinks ?? []) {
    if (link?.type?.name !== LinkType.USED_IN) continue;
    const other = link.outwardIssue?.key ?? link.inwardIssue?.key;
    if (other) keys.add(other);
  }
  return [...keys];
}

/** One Build's `{ key, isBuild, status, buildNumber }`, read by key; null for a 404. */
export async function readBuildState(jiraClient, key) {
  let issue;
  try {
    issue = await jiraClient.getIssue(key, {
      fields: ['issuetype', 'status', BuildField.BUILD_NUMBER],
    });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
  return {
    key,
    isBuild: issue?.fields?.issuetype?.name === 'Build',
    status: issue?.fields?.status?.name ?? null,
    buildNumber: issue?.fields?.[BuildField.BUILD_NUMBER] ?? null,
  };
}

/**
 * The cut Builds among `keys`, each read by key. `cache` (key -> promise)
 * shares reads across one request.
 *
 * @param {object} jiraClient
 * @param {string[]} keys
 * @param {Map<string, Promise<object|null>>} [cache]
 * @returns {Promise<{ key: string, buildNumber: number|null, status: string }[]>}
 */
export async function cutBuildsAmong(jiraClient, keys, cache = new Map()) {
  const states = await Promise.all(keys.map((key) => {
    if (!cache.has(key)) cache.set(key, readBuildState(jiraClient, key));
    return cache.get(key);
  }));
  return states
    .filter((s) => s?.isBuild && isCutStatus(s.status))
    .map(({ key, buildNumber, status }) => ({ key, buildNumber, status }));
}
