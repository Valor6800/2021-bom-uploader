/**
 * Assembly search — pure helpers behind GET /api/epics/search.
 *
 * JQL text search can't find a bare number ("0000") or a season word
 * ("facility 2027"), so the service lists the Assembly set with JQL and the
 * matching, ranking and season grouping happen here, in plain code.
 */
import { applyPartMask, applyTitleMask } from './partMask.js';
import { RevisionField } from './buildConstants.js';
import { configurationFrom } from './onshapeConfiguration.js';

/** Fields the search JQL and the direct key lookup ask the tracker for. */
export const ASSEMBLY_FIELDS = [
  'summary', 'status', 'created', 'customfield_10104', RevisionField.REVISION,
  'customfield_10300', 'customfield_10301', 'customfield_10302', 'issuetype', 'description',
];

/** Issue type names that count as an Assembly (the API name is "Epic"). */
const ASSEMBLY_TYPES = new Set(['Epic', 'Assembly']);

/** Statuses that make an Assembly "closed". */
const CLOSED_STATUSES = new Set(['Closed', 'Finished']);

/** A query that looks like a tracker key, any case. */
export const KEY_SHAPED_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** Loose season prefix, so "VF27-0200 Tooling" still groups under Facility 2027. */
const LOOSE_SEASON_RE = /^V([RF])(\d{2})/;

const SEASON_NAMES = { R: 'Robot', F: 'Facility' };

/**
 * @param {object} issue
 * @returns {boolean} true when the issue's type is Epic or Assembly
 */
export function isAssemblyIssue(issue) {
  return ASSEMBLY_TYPES.has(issue?.fields?.issuetype?.name);
}

/**
 * Trim, lower-case and collapse whitespace.
 * @param {string} query
 * @returns {string}
 */
export function normalizeQuery(query) {
  return String(query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {string} query
 * @returns {string[]} normalized tokens; empty for an empty query
 */
export function tokenize(query) {
  const normalized = normalizeQuery(query);
  return normalized ? normalized.split(' ') : [];
}

/**
 * The one shared Assembly shape, used by search and GET /api/epics/:key.
 *
 * @param {object} issue  Raw tracker issue
 * @param {object} [options]
 * @param {string} [options.onshapeBaseUrl]  Used to build onshapeUrl
 * @returns {object}
 */
export function toAssembly(issue, { onshapeBaseUrl } = {}) {
  const f = issue?.fields ?? {};
  const summary = f.summary ?? '';
  const parsed = applyPartMask(summary) ?? applyTitleMask(summary);
  const numbered = !!parsed && parsed.isEpic;

  let seasonType = parsed?.seasonType ?? null;
  let year = parsed?.year ?? null;
  if (!parsed) {
    const loose = LOOSE_SEASON_RE.exec(summary);
    if (loose) [, seasonType, year] = loose;
  }
  const hasSeason = !!(seasonType && year);

  const documentId = f.customfield_10300 ?? null;
  const workspaceId = f.customfield_10301 ?? null;
  const elementId = f.customfield_10302 ?? null;
  const base = onshapeBaseUrl ? onshapeBaseUrl.replace(/\/+$/, '') : null;
  const configuration = configurationFrom(f.description);
  const onshapeUrl = base && documentId && workspaceId && elementId
    ? `${base}/documents/${documentId}/w/${workspaceId}/e/${elementId}${configuration ? `?configuration=${encodeURIComponent(configuration)}` : ''}`
    : null;

  const statusName = f.status?.name ?? null;
  return {
    key: issue.key,
    summary,
    name: numbered ? parsed.name : summary,
    numbered,
    fullPartNumber: numbered ? parsed.fullPartNumber : null,
    partNumber: numbered ? parsed.partNumber : null,
    revision: f[RevisionField.REVISION] ?? parsed?.version ?? null,
    seasonType: hasSeason ? seasonType : null,
    year: hasSeason ? year : null,
    seasonCode: hasSeason ? `V${seasonType}${year}` : null,
    seasonLabel: hasSeason ? `${SEASON_NAMES[seasonType]} 20${year}` : null,
    status: statusName,
    closed: CLOSED_STATUSES.has(statusName),
    created: f.created ?? null,
    documentId,
    workspaceId,
    elementId,
    configuration,
    onshapeUrl,
  };
}

/**
 * Everything a token may match, lower-cased.
 * @param {object} assembly  A toAssembly result
 * @returns {string[]}
 */
function haystack(assembly) {
  return [
    assembly.key,
    assembly.summary,
    assembly.fullPartNumber,
    assembly.partNumber,
    assembly.seasonCode,
    assembly.seasonLabel,
    assembly.year ? `20${assembly.year}` : null,
  ].filter(Boolean).map((s) => s.toLowerCase());
}

/**
 * Every token must be a substring of some haystack entry. An empty token
 * list matches everything.
 *
 * @param {object} assembly
 * @param {string[]} tokens
 * @returns {boolean}
 */
export function matchAssembly(assembly, tokens) {
  const hay = haystack(assembly);
  return tokens.every((t) => hay.some((h) => h.includes(t)));
}

/**
 * 100 exact key, 90 exact full number, 80 exact bare number, 60 name starts
 * with the first token, 40 anything else.
 *
 * @param {object} assembly
 * @param {string[]} tokens
 * @returns {number}
 */
export function rankAssembly(assembly, tokens) {
  const q = tokens.join(' ');
  if (q && q === assembly.key?.toLowerCase()) return 100;
  if (q && q === assembly.fullPartNumber?.toLowerCase()) return 90;
  if (q && q === assembly.partNumber) return 80;
  if (tokens.length && assembly.name?.toLowerCase().startsWith(tokens[0])) return 60;
  return 40;
}

/** Newest `created` first; missing dates last. */
function byNewest(a, b) {
  return String(b.created ?? '').localeCompare(String(a.created ?? ''));
}

/** Highest score first, then newest. */
export function compareRanked(a, b) {
  return (b.score - a.score) || byNewest(a, b);
}

/**
 * Group Assemblies by season: newest year first, Robot before Facility in a
 * year, newest Assembly first in a group, and a final "Other" group for
 * Assemblies with no season.
 *
 * @param {object[]} assemblies
 * @returns {{ label: string, seasonCode: string|null, members: object[] }[]}
 */
export function groupBySeason(assemblies) {
  const groups = new Map();
  for (const a of assemblies) {
    const id = a.seasonCode ?? null;
    if (!groups.has(id)) {
      groups.set(id, {
        label: id ? a.seasonLabel : 'Other',
        seasonCode: id,
        year: a.year,
        seasonType: a.seasonType,
        members: [],
      });
    }
    groups.get(id).members.push(a);
  }
  const typeOrder = { R: 0, F: 1 };
  return [...groups.values()]
    .sort((a, b) => {
      if (!a.seasonCode) return 1;
      if (!b.seasonCode) return -1;
      return (b.year.localeCompare(a.year)) || (typeOrder[a.seasonType] - typeOrder[b.seasonType]);
    })
    .map(({ label, seasonCode, members }) => ({
      label,
      seasonCode,
      members: [...members].sort(byNewest),
    }));
}

/**
 * Match, rank (or group, for an empty query), count and cap.
 *
 * @param {object[]} assemblies  toAssembly results, de-duplicated by key
 * @param {string} query
 * @param {number} limit
 * @returns {{ query: string, total: number, results: object[], groups: object[]|null }}
 */
export function searchAssemblyList(assemblies, query, limit) {
  const tokens = tokenize(query);
  const matched = assemblies
    .filter((a) => matchAssembly(a, tokens))
    .map((a) => ({ ...a, score: rankAssembly(a, tokens) }));

  if (tokens.length) {
    const results = matched.sort(compareRanked).slice(0, limit);
    return { query, total: matched.length, results, groups: null };
  }

  const grouped = groupBySeason(matched);
  const results = grouped.flatMap((g) => g.members).slice(0, limit);
  const kept = new Set(results.map((a) => a.key));
  const groups = grouped
    .map((g) => ({
      label: g.label,
      seasonCode: g.seasonCode,
      keys: g.members.map((a) => a.key).filter((k) => kept.has(k)),
    }))
    .filter((g) => g.keys.length > 0);
  return { query, total: matched.length, results, groups };
}
