/**
 * Pure helpers for Build lists on the Designer and Assembly pages: labels,
 * the next number, default selection, merging Builds the search hasn't
 * indexed yet, the session status overlay, and the two-Active repair rules.
 *
 * No imports, so the server-side Jest suite tests it directly.
 */

/** Most Builds one by-key status check may read (GET /api/builds/status). */
export const MAX_STATUS_KEYS = 10;

/** "Build 3", falling back to the summary (or key) when there's no number. */
export function buildLabel(build) {
  if (!build) return '';
  if (build.buildNumber !== null && build.buildNumber !== undefined) return `Build ${build.buildNumber}`;
  return build.summary || build.key;
}

/** Trim and collapse internal whitespace, as the server does. */
function collapse(text) {
  return typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
}

/**
 * The summary the server will give a new Build: `{name} Build {N}`, plus
 * ` - {description}` when one is typed. Display only.
 */
export function buildSummaryPreview(name, number, description) {
  const base = `${collapse(name)} Build ${number}`;
  const d = collapse(description);
  return d ? `${base} - ${d}` : base;
}

/** One past the highest Build number over the whole Revision chain, or 1. */
export function nextBuildNumber(chainBuilds) {
  const max = (chainBuilds ?? []).reduce((acc, b) => Math.max(acc, b.buildNumber ?? 0), 0);
  return max + 1;
}

/** The Builds of one Revision ticket. */
export function visibleBuilds(chainBuilds, key) {
  return (chainBuilds ?? []).filter((b) => b.assemblyKey === key);
}

/** Archived Builds are hidden unless one is the selected Build. */
export function pickerBuilds(builds, selectedKey) {
  return (builds ?? []).filter((b) => b.status !== 'Archived' || b.key === selectedKey);
}

const byNumberDesc = (a, b) => (b.buildNumber ?? 0) - (a.buildNumber ?? 0);

/**
 * Which Build a page opens on: `requested` when it is in the list, else the
 * newest Draft, then the Active one, then the highest number. Archived
 * Builds are only ever chosen by request.
 *
 * @returns {string|null}
 */
export function defaultBuildKey(builds, requested) {
  const list = builds ?? [];
  if (requested && list.some((b) => b.key === requested)) return requested;
  const open = list.filter((b) => b.status !== 'Archived').sort(byNumberDesc);
  return open.find((b) => b.status === 'Draft')?.key
    ?? open.find((b) => b.status === 'Active')?.key
    ?? open[0]?.key
    ?? null;
}

/**
 * Which Build tab the Assembly page opens on (design 3.5): `requested`
 * when it is in the list, else the Active one, then the highest number.
 * Archived Builds are only ever chosen by request.
 *
 * @returns {string|null}
 */
export function defaultAssembleBuildKey(builds, requested) {
  const list = builds ?? [];
  if (requested && list.some((b) => b.key === requested)) return requested;
  const open = list.filter((b) => b.status !== 'Archived').sort(byNumberDesc);
  return open.find((b) => b.status === 'Active')?.key ?? open[0]?.key ?? null;
}

/**
 * The Build a Part counts as current in: the highest-numbered of the
 * Builds it is linked to, among `builds`. Null when it is in none of them.
 *
 * @param {Iterable<string>} partBuildKeys
 * @param {object[]} builds
 * @returns {object|null}
 */
export function currentBuildOf(partBuildKeys, builds) {
  const linked = new Set(partBuildKeys ?? []);
  return [...(builds ?? [])].filter((b) => linked.has(b.key)).sort(byNumberDesc)[0] ?? null;
}

/**
 * Append Builds that search hasn't returned yet. The fetched copy wins
 * when a key is in both, since it is fresher.
 *
 * @param {object[]} fetched
 * @param {object|object[]|null} extra  One Build or a list (created this session)
 */
export function mergeBuilds(fetched, extra) {
  const extras = (Array.isArray(extra) ? extra : [extra]).filter(Boolean);
  if (extras.length === 0) return fetched;
  const seen = new Set(fetched.map((b) => b.key));
  const added = [];
  for (const b of extras) {
    if (seen.has(b.key)) continue;
    seen.add(b.key);
    added.push(b);
  }
  return added.length ? [...fetched, ...added] : fetched;
}

/**
 * Apply this session's known statuses (`Map<key, { status, onshapeVersionLink? }>`)
 * over a fetched list, because search reports a status change late.
 */
export function overlayBuildStatus(builds, statusThisSession) {
  if (!statusThisSession || statusThisSession.size === 0) return builds;
  return builds.map((b) => {
    const entry = statusThisSession.get(b.key);
    if (!entry) return b;
    const next = { ...b, status: entry.status };
    if (entry.onshapeVersionLink !== undefined) next.onshapeVersionLink = entry.onshapeVersionLink;
    return next;
  });
}

/** Drop overlay entries a fetched list now agrees with. */
export function dropAgreedStatus(statusThisSession, fetched) {
  if (!statusThisSession || statusThisSession.size === 0) return statusThisSession;
  const byKey = new Map(fetched.map((b) => [b.key, b]));
  let changed = false;
  const next = new Map();
  for (const [key, entry] of statusThisSession) {
    if (byKey.get(key)?.status === entry.status) {
      changed = true;
      continue;
    }
    next.set(key, entry);
  }
  return changed ? next : statusThisSession;
}

/** The Active Builds, when there is more than one; otherwise []. */
export function activeConflict(builds) {
  const active = (builds ?? []).filter((b) => b.status === 'Active');
  return active.length > 1 ? active : [];
}

/** A stable id for a set of conflicting Builds. */
export function conflictSignature(conflict) {
  return conflict.map((b) => b.key).sort().join(',');
}

/** The keys a by-key status check sends: at most 10, highest numbers first. */
export function statusCheckKeys(conflict) {
  return [...conflict].sort(byNumberDesc).slice(0, MAX_STATUS_KEYS).map((b) => b.key);
}

/**
 * Builds the two-Active warning offers a button for. The Build whose cut
 * failed in this session wins outright; otherwise only Builds cut from
 * this document (their link holds `/documents/<id>/v/`), because the
 * server refuses any other.
 *
 * @returns {{ build: object, label: string }[]}
 */
export function repairCandidates({ conflict, cutFailedKey, documentId }) {
  const failed = cutFailedKey && conflict.find((b) => b.key === cutFailedKey);
  if (failed) return [{ build: failed, label: `Finish cutting ${buildLabel(failed)}` }];
  if (!documentId) return [];
  const marker = `/documents/${documentId}/v/`;
  return conflict
    .filter((b) => typeof b.onshapeVersionLink === 'string' && b.onshapeVersionLink.includes(marker))
    .map((build) => ({ build, label: `Make ${buildLabel(build)} the Active one` }));
}

/** The other conflicting Builds, which a repair marks Superseded. */
export function supersedeTargets(conflict, chosenKey) {
  return conflict.filter((b) => b.key !== chosenKey);
}

/** Overlay entries from a successful (or resumed) Cut Version. */
export function cutResultEntries(buildKey, result) {
  return [
    [buildKey, { status: 'Active', onshapeVersionLink: result?.onshapeVersionLink ?? null }],
    ...(result?.superseded ?? []).map((k) => [k, { status: 'Superseded' }]),
  ];
}

/**
 * Overlay entries from a failed Cut Version: a supersede-stage failure
 * leaves the Build Active with its link; a 409 carries the Build's status
 * as `buildStatus` (never `status`, which is the HTTP code).
 */
export function cutErrorEntries(buildKey, err) {
  const body = err?.body ?? {};
  if (body.cutStage === 'supersede') {
    return [[buildKey, { status: 'Active', onshapeVersionLink: body.onshapeVersionLink ?? null }]];
  }
  if (err?.status === 409 && typeof body.buildStatus === 'string') {
    return [[buildKey, { status: body.buildStatus }]];
  }
  return [];
}

/** Overlay entries from GET /api/builds/status; a missing key is not Active. */
export function statusCheckEntries(response) {
  return [
    ...(response?.builds ?? []).map((b) => [b.key, { status: b.status, onshapeVersionLink: b.onshapeVersionLink ?? null }]),
    ...(response?.missing ?? []).map((k) => [k, { status: 'Missing' }]),
  ];
}

/** "Build 1 and Build 2", "Build 1, Build 2 and Build 3" (lowest number first). */
export function listLabels(builds) {
  const labels = [...builds].sort((a, b) => (a.buildNumber ?? 0) - (b.buildNumber ?? 0)).map(buildLabel);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
