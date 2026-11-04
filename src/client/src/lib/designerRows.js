/**
 * Pure row model for the Designer's Parts table (and the shared Part
 * helpers the Assembly page uses): which group each Part is in, what CAD
 * changed, what the student edited, and the session overlays that cover
 * search lag after a save.
 *
 * No imports from React or the API, so the server-side Jest suite tests it.
 */

/** The BOM fields CAD sets and a row can differ on. Priority is separate (tracker-only). */
export const PART_FIELDS = ['quantity', 'material', 'machinery', 'powdercoat', 'tapping', 'thickness'];

/**
 * The fields CAD owns. Quantity and Material always follow CAD. The rest
 * (machinery, powdercoat, tapping, thickness, priority) are set when a Part is made
 * and are the student's from then on: CAD never overwrites them, so a saved
 * choice stays saved.
 */
export const CAD_FIELDS = ['quantity', 'material'];

/**
 * Fields the student can't edit: OnShape sets them. A CAD value still
 * applies on Update from CAD; an edit to one is dropped.
 */
export const LOCKED_FIELDS = ['material'];

const FIELD_LABELS = {
  quantity: 'Qty',
  material: 'Material',
  machinery: 'Machinery',
  powdercoat: 'Powdercoat',
  tapping: 'Tapping',
  thickness: 'Thickness',
};

function pickValues(source) {
  const out = {};
  for (const f of PART_FIELDS) {
    if (source && source[f] !== undefined) out[f] = source[f];
  }
  // Priority comes from the tracker, not CAD: a stored Part has one (or null),
  // a CAD row has none.
  if (source && source.priority !== undefined) out.priority = source.priority;
  return out;
}

/**
 * `Map<partKey, Set<buildKey>>` from each Build's linked Part keys.
 * @param {Map<string, string[]>} perBuild  buildKey -> linked Part keys
 */
export function linksFromBuildParts(perBuild) {
  const out = new Map();
  for (const [buildKey, keys] of perBuild ?? []) {
    for (const partKey of keys ?? []) {
      if (!out.has(partKey)) out.set(partKey, new Set());
      out.get(partKey).add(buildKey);
    }
  }
  return out;
}

/**
 * Add this session's links (`Map<buildKey, Set<partKey>>`) to the fetched
 * ones, so a Part just added to a Build stays in it while search lags.
 */
export function mergeLinks(linkedByPart, linkedThisSession, unlinkedThisSession) {
  const out = new Map();
  for (const [partKey, builds] of linkedByPart ?? []) out.set(partKey, new Set(builds));
  for (const [buildKey, partKeys] of linkedThisSession ?? []) {
    for (const partKey of partKeys) {
      if (!out.has(partKey)) out.set(partKey, new Set());
      out.get(partKey).add(buildKey);
    }
  }
  for (const [buildKey, partKeys] of unlinkedThisSession ?? []) {
    for (const partKey of partKeys) out.get(partKey)?.delete(buildKey);
  }
  return out;
}

/** Drop session links a fetch of that Build's Parts now lists. */
export function dropAgreedLinks(linkedThisSession, perBuild) {
  if (!linkedThisSession || linkedThisSession.size === 0) return linkedThisSession;
  let changed = false;
  const next = new Map();
  for (const [buildKey, partKeys] of linkedThisSession) {
    const fetched = perBuild?.get(buildKey);
    if (!fetched) {
      next.set(buildKey, partKeys);
      continue;
    }
    const fetchedSet = new Set(fetched);
    const kept = new Set([...partKeys].filter((k) => !fetchedSet.has(k)));
    if (kept.size !== partKeys.size) changed = true;
    if (kept.size) next.set(buildKey, kept);
  }
  return changed ? next : linkedThisSession;
}

/** Drop session unlinks a fetch of that Build's Parts no longer lists. */
export function dropAgreedUnlinks(unlinkedThisSession, perBuild) {
  if (!unlinkedThisSession || unlinkedThisSession.size === 0) return unlinkedThisSession;
  let changed = false;
  const next = new Map();
  for (const [buildKey, partKeys] of unlinkedThisSession) {
    const fetched = perBuild?.get(buildKey);
    if (!fetched) {
      next.set(buildKey, partKeys);
      continue;
    }
    const fetchedSet = new Set(fetched);
    const kept = new Set([...partKeys].filter((k) => fetchedSet.has(k)));
    if (kept.size !== partKeys.size) changed = true;
    if (kept.size) next.set(buildKey, kept);
  }
  return changed ? next : unlinkedThisSession;
}

/** Add `partKeys` to `linkedThisSession` for `buildKey`; returns a new Map. */
export function addSessionLinks(linkedThisSession, buildKey, partKeys) {
  const next = new Map(linkedThisSession ?? []);
  const set = new Set(next.get(buildKey) ?? []);
  for (const k of partKeys) set.add(k);
  next.set(buildKey, set);
  return next;
}

/**
 * Fetched Parts plus Parts created this session (`Map<key, Part>`) that
 * search doesn't list yet. The fetched copy wins.
 */
export function mergeParts(fetched, createdParts) {
  if (!createdParts || createdParts.size === 0) return fetched;
  const seen = new Set(fetched.map((p) => p.key));
  const extra = [...createdParts.values()].filter((p) => !seen.has(p.key));
  return extra.length ? [...fetched, ...extra] : fetched;
}

/** Drop created Parts (`Map<key, Part>`) a re-fetch now lists. */
export function dropAgreedParts(createdParts, fetched) {
  if (!createdParts || createdParts.size === 0) return createdParts;
  const seen = new Set((fetched ?? []).map((p) => p.key));
  const next = new Map([...createdParts].filter(([key]) => !seen.has(key)));
  return next.size === createdParts.size ? createdParts : next;
}

/**
 * Rows for comparing two Builds: every Part in either, shared Parts first,
 * then by summary.
 *
 * @param {object[]} parts
 * @param {Map<string, Set<string>>} links  partKey -> Build keys (merged with the session)
 * @param {string} aKey
 * @param {string} bKey
 * @returns {{ part: object, inA: boolean, inB: boolean, shared: boolean }[]}
 */
export function compareBuildRows(parts, links, aKey, bKey) {
  if (!aKey || !bKey) return [];
  return (parts ?? [])
    .map((part) => {
      const keys = links?.get(part.key) ?? new Set();
      const inA = keys.has(aKey);
      const inB = keys.has(bKey);
      return { part, inA, inB, shared: inA && inB };
    })
    .filter((r) => r.inA || r.inB)
    .sort((x, y) => Number(y.shared) - Number(x.shared)
      || (x.part.summary ?? '').localeCompare(y.part.summary ?? ''));
}

/** "Changed in CAD: Qty 1→3, Material PLA→PETG-CF" */
export function describeChanges(changes) {
  const parts = Object.entries(changes ?? {}).map(
    ([f, { from, to }]) => `${FIELD_LABELS[f]} ${from}→${to}`,
  );
  return parts.length ? `Changed in CAD: ${parts.join(', ')}` : '';
}

/** "HAR-2031" -> 2031. */
function keyNumber(key) {
  const match = /-(\d+)$/.exec(key ?? '');
  return match ? Number(match[1]) : Infinity;
}

/**
 * The original of each full number: the Part created first (lowest ticket
 * number). Create spare repeats a number, so the rest are spares.
 * Same rule as isMoreOriginal in the server's utils/partChain.js.
 */
function originalsByNumber(parts) {
  const out = new Map();
  for (const part of parts) {
    if (!part.fullPartNumber) continue;
    const current = out.get(part.fullPartNumber);
    if (!current || keyNumber(part.key) < keyNumber(current.key)) out.set(part.fullPartNumber, part);
  }
  return out;
}

function withoutLocked(edit) {
  if (!edit) return {};
  const out = { ...edit };
  for (const f of LOCKED_FIELDS) delete out[f];
  return out;
}

function pickCadValues(source) {
  const out = {};
  for (const f of CAD_FIELDS) {
    if (source && source[f] !== undefined) out[f] = source[f];
  }
  return out;
}

function diff(stored, next) {
  const changes = {};
  for (const f of CAD_FIELDS) {
    if (next[f] !== undefined && next[f] !== stored[f]) changes[f] = { from: stored[f], to: next[f] };
  }
  return changes;
}

function sortRows(rows) {
  return rows.sort((a, b) => (a.fullPartNumber ?? a.rowId).localeCompare(b.fullPartNumber ?? b.rowId));
}

/**
 * @param {object} params
 * @param {object[]} params.parts             Chain Parts plus linked Parts fetched by key
 * @param {Map<string, object>} [params.createdParts]
 * @param {string[]} params.chainKeys         The Revision chain; a Part outside it is read-only
 * @param {Map<string, Set<string>>} params.linkedByPart
 * @param {Map<string, Set<string>>} [params.linkedThisSession]
 * @param {string|null} params.buildKey       The selected Build
 * @param {object[]} [params.builds]          For "Also in Build 2" labels, and
 *   which Builds are cut: a Part a cut Build uses keeps its stored values
 *   (`sharedLocked`) until it is Re-created
 * @param {{ newParts: object[], existingParts: object[] }|null} [params.preview]
 * @param {Record<string, object>} [params.edits]        rowId -> { field: value }
 * @param {Record<string, string>} [params.createdKeys]  fullPartNumber -> key
 * @param {Record<string, object>} [params.rowResults]   rowId -> last save result
 * @returns {{ groups: { newFromCad: object[], inBuild: object[], other: object[] }, pendingOps: string[] }}
 */
export function deriveDesignerRows({
  parts,
  createdParts,
  chainKeys,
  linkedByPart,
  linkedThisSession,
  unlinkedThisSession,
  buildKey,
  builds = [],
  preview = null,
  edits = {},
  createdKeys = {},
  rowResults = {},
}) {
  const all = mergeParts(parts ?? [], createdParts);
  const links = mergeLinks(linkedByPart, linkedThisSession, unlinkedThisSession);
  const chain = new Set(chainKeys ?? []);
  const buildLabels = new Map(builds.map((b) => [b.key, b.buildNumber != null ? `Build ${b.buildNumber}` : b.summary]));
  const cutKeys = new Set(builds.filter((b) => b.status && b.status !== 'Draft').map((b) => b.key));

  const byKey = new Map();
  const byNumber = new Map();
  for (const part of all) {
    byKey.set(part.key, part);
  }
  for (const [number, original] of originalsByNumber(all)) byNumber.set(number, original);

  // CAD values for existing Parts, by key.
  const cadByKey = new Map();
  for (const ex of preview?.existingParts ?? []) {
    if (ex?.story?.key) cadByKey.set(ex.story.key, ex.bomItem);
  }

  const newItems = [];
  const synthetic = new Map();
  for (const item of preview?.newParts ?? []) {
    const key = createdKeys[item.fullPartNumber] ?? byNumber.get(item.fullPartNumber)?.key;
    if (!key) {
      newItems.push(item);
      continue;
    }
    cadByKey.set(key, item);
    if (!byKey.has(key)) {
      // Created this session, not listed by search yet.
      synthetic.set(key, {
        ...item,
        key,
        epic: chainKeys?.[0] ?? item.epic ?? null,
      });
    }
  }

  const groups = { newFromCad: [], inBuild: [], other: [] };
  const pendingOps = [];

  const existing = [...all, ...synthetic.values()];
  const originals = originalsByNumber(existing);

  // Units of each Part already in this Build, across every ticket of that number.
  const inBuildQty = new Map();
  for (const part of existing) {
    if (!buildKey || !(links.get(part.key) ?? new Set()).has(buildKey) || !part.fullPartNumber) continue;
    const qty = rowResults[part.key]?.values?.quantity ?? part.quantity ?? 0;
    inBuildQty.set(part.fullPartNumber, (inBuildQty.get(part.fullPartNumber) ?? 0) + qty);
  }

  // A Part that a new Revision (from the preview) is replacing.
  const replacedBy = new Map();
  for (const item of preview?.newParts ?? []) {
    if (item.revises) replacedBy.set(item.revises, item.version);
  }
  const baselineLabel = preview?.baseline?.buildNumber != null ? ` since Build ${preview.baseline.buildNumber}` : '';
  const copyRows = [];

  for (const part of existing) {
    const rowId = part.key;
    const result = rowResults[rowId];
    const stored = { ...pickValues(part), ...(result?.values ?? {}) };
    const cad = cadByKey.get(part.key);
    const cadValues = cad ? pickCadValues(cad) : null;
    const changes = cadValues ? diff(stored, cadValues) : {};
    const changedInCad = Object.keys(changes).length > 0;
    const readOnly = chain.size > 0 && !chain.has(part.epic);
    const partBuilds = links.get(part.key) ?? new Set();
    const cutBuildKeys = [...partBuilds].filter((k) => k !== buildKey && cutKeys.has(k));
    const sharedLocked = !readOnly && cutBuildKeys.length > 0;
    const values = sharedLocked
      ? stored
      : { ...stored, ...(cadValues ?? {}), ...withoutLocked(edits[rowId]) };
    const dirty = PART_FIELDS.some((f) => values[f] !== stored[f]) || (values.priority ?? null) !== (stored.priority ?? null);
    const inBuild = !!buildKey && partBuilds.has(buildKey);
    const otherBuildKeys = [...partBuilds].filter((k) => k !== buildKey && buildLabels.has(k));
    const isSpare = !!part.fullPartNumber && originals.get(part.fullPartNumber)?.key !== part.key;
    const label = isSpare
      ? 'Spare'
      : otherBuildKeys.length
        ? `Also in ${otherBuildKeys.map((k) => buildLabels.get(k)).join(', ')}`
        : 'Not in any Build';

    // A Part that a cut Build made is reused only by copying it into the Build
    // when it is made. If CAD needs more than the Build holds, the missing
    // units are made as an exact copy (its own row below).
    if (sharedLocked && cad && !isSpare) {
      const have = inBuildQty.get(part.fullPartNumber) ?? 0;
      const need = (cad.quantity ?? 0) - have;
      if (need > 0 && !createdKeys[`copy:${part.key}`]) {
        copyRows.push({ part, stored, need, have });
      }
    }

    // A Part that belongs to other Builds only is not this Build's business:
    // hide it unless there is work on it. A Part in no Build at all (a spare)
    // always shows. One a cut Build made, and this Build doesn't hold, is
    // made again through its copy row.
    if (!inBuild && partBuilds.size > 0 && !result && !edits[rowId]
      && (!cad || sharedLocked)) continue;

    const replacement = replacedBy.get(part.key);
    const revisionNote = replacement
      ? { kind: 'replaced', text: `Replaced by Revision ${replacement} when you Save.` }
      : null;

    let status;
    if (result && result.ok === false) status = 'Error';
    else if (dirty) status = 'Changed';
    else if (result?.ok) status = 'Saved';
    else status = inBuild ? 'In Build' : label;

    const row = {
      rowId,
      key: part.key,
      isNew: false,
      fullPartNumber: part.fullPartNumber ?? null,
      summary: part.summary,
      name: part.name,
      version: part.version ?? null,
      epic: part.epic ?? null,
      stored,
      values,
      changes,
      changedInCad,
      changeText: describeChanges(changes),
      dirty: !readOnly && dirty,
      readOnly,
      readOnlyLabel: readOnly ? 'From another Assembly' : null,
      sharedLocked,
      lockedLabel: sharedLocked ? `In cut ${cutBuildKeys.map((k) => buildLabels.get(k)).join(', ')}` : null,
      revisionNote,
      // Spares share their original's picture.
      imageKey: originals.get(part.fullPartNumber)?.key ?? part.key,
      group: inBuild ? 'inBuild' : 'other',
      buildKeys: [...partBuilds],
      otherBuildKeys,
      isSpare,
      label,
      status,
      result: result ?? null,
    };
    groups[row.group].push(row);
    if (row.dirty) pendingOps.push(rowId);
  }

  for (const item of newItems) {
    const rowId = item.fullPartNumber;
    const result = rowResults[rowId];
    const values = { ...pickValues(item), ...withoutLocked(edits[rowId]) };
    groups.newFromCad.push({
      rowId,
      key: null,
      isNew: true,
      fullPartNumber: item.fullPartNumber,
      summary: item.summary,
      name: item.name,
      version: item.version ?? null,
      revision: item.version ?? null,
      epic: item.epic ?? null,
      stored: null,
      values,
      changes: {},
      changedInCad: false,
      changeText: '',
      dirty: true,
      readOnly: false,
      readOnlyLabel: null,
      sharedLocked: false,
      lockedLabel: null,
      // The tool numbers a part CAD has no number for: the number shown is
      // the next free one, and Save keeps it unless it was taken meanwhile.
      imageKey: null,
      cadRef: item.cadRef ?? null,
      proposedNumber: item.proposedNumber === true,
      revises: item.revises ?? null,
      revisionNote: item.replaces
        ? {
          kind: 'new-revision',
          text: `Design changed${baselineLabel}: Revision ${item.version} replaces Revision ${item.replaces.version}.`,
        }
        : null,
      group: 'new',
      buildKeys: [],
      otherBuildKeys: [],
      label: 'New',
      status: result && result.ok === false ? 'Error' : 'New',
      result: result ?? null,
    });
    pendingOps.push(rowId);
  }

  for (const { part, stored, need, have } of copyRows) {
    const rowId = `copy:${part.key}`;
    const result = rowResults[rowId];
    groups.newFromCad.push({
      rowId,
      key: null,
      isNew: true,
      isCopy: true,
      copyOf: part.key,
      imageKey: originals.get(part.fullPartNumber)?.key ?? part.key,
      fullPartNumber: part.fullPartNumber,
      summary: part.summary,
      name: part.name,
      version: part.version ?? null,
      revision: part.version ?? null,
      epic: part.epic ?? null,
      stored: null,
      values: { ...stored, quantity: need },
      changes: {},
      changedInCad: false,
      changeText: '',
      dirty: true,
      readOnly: false,
      readOnlyLabel: null,
      sharedLocked: false,
      lockedLabel: null,
      revisionNote: {
        kind: 'copy',
        text: have > 0
          ? `CAD needs ${have + need}; ${have} already in this Build. Make ${need} more.`
          : `Make ${need} new.`,
      },
      group: 'new',
      buildKeys: [],
      otherBuildKeys: [],
      label: 'New',
      status: result && result.ok === false ? 'Error' : 'New',
      result: result ?? null,
    });
    pendingOps.push(rowId);
  }

  sortRows(groups.newFromCad);
  sortRows(groups.inBuild);
  sortRows(groups.other);
  return { groups, pendingOps };
}
