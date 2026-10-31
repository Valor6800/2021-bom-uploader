/**
 * Pure save planning for the Designer:
 * turn the row groups into a POST /api/builds/:key/save body, hold back
 * rows the server would refuse, split the body into small batches, and
 * fold per-item results back into page state.
 */
import { validateRowFields } from './partValidation.js';
import { PART_FIELDS } from './designerRows.js';

/** Items per save request (design 3.4 step 5). */
export const SAVE_BATCH = 25;

function valuesOf(row) {
  const out = {};
  for (const f of PART_FIELDS) out[f] = row.values[f];
  // Priority goes only when it changed: it has to be on the Part screen in the
  // tracker to be written, and every other save must work without it.
  const priority = row.values.priority;
  if (priority !== undefined && priority !== null && priority !== (row.stored?.priority ?? null)) {
    out.priority = priority;
  }
  return out;
}

/**
 * @param {{ newFromCad: object[], inBuild: object[], other: object[] }} groups
 * @param {Set<string>} selection  Selected rowIds (New and Other rows)
 * @param {{ only?: Set<string> }} [options]  Plan only these rowIds (a row's Retry)
 * @returns {{ body: { creates: object[], updates: object[], links: object[] },
 *   heldBack: { rowId: string, field: string, error: string }[] }}
 */
export function planSave(groups, selection, { only } = {}) {
  const creates = [];
  const updates = [];
  const links = [];
  const heldBack = [];
  const wanted = (rowId) => !only || only.has(rowId);

  for (const row of groups.newFromCad ?? []) {
    if (!selection.has(row.rowId) || !wanted(row.rowId)) continue;
    const item = {
      ref: row.rowId,
      summary: row.summary,
      revision: row.revision ?? row.version ?? undefined,
      ...valuesOf(row),
    };
    const problem = validateRowFields(item);
    if (problem) heldBack.push({ rowId: row.rowId, ...problem });
    else creates.push(item);
  }

  for (const row of [...(groups.inBuild ?? []), ...(groups.other ?? [])]) {
    if (row.readOnly || !wanted(row.rowId)) continue;
    const addToBuild = row.group === 'other' && selection.has(row.rowId);
    if (row.dirty) {
      const item = { ref: row.rowId, key: row.key, ...valuesOf(row), link: addToBuild };
      const problem = validateRowFields(item);
      if (problem) heldBack.push({ rowId: row.rowId, ...problem });
      else updates.push(item);
    } else if (addToBuild) {
      links.push({ ref: row.rowId, key: row.key });
    }
  }

  return { body: { creates, updates, links }, heldBack };
}

/** Number of items in a save body. */
export function bodySize(body) {
  return (body.creates?.length ?? 0) + (body.updates?.length ?? 0) + (body.links?.length ?? 0);
}

/** Counts for the save bar: new Parts, changes, and Parts added to the Build. */
export function saveCounts(body) {
  return {
    creates: body.creates.length,
    updates: body.updates.length,
    added: body.links.length + body.updates.filter((u) => u.link).length,
  };
}

/**
 * Split a body into requests of at most `size` items: creates first, then
 * updates, then links, keeping order.
 */
export function batchBody(body, size = SAVE_BATCH) {
  const flat = [
    ...(body.creates ?? []).map((item) => ['creates', item]),
    ...(body.updates ?? []).map((item) => ['updates', item]),
    ...(body.links ?? []).map((item) => ['links', item]),
  ];
  const batches = [];
  for (let i = 0; i < flat.length; i += size) {
    const batch = { creates: [], updates: [], links: [] };
    for (const [list, item] of flat.slice(i, i + size)) batch[list].push(item);
    batches.push(batch);
  }
  return batches;
}

/**
 * Fold one save response into page state.
 *
 * @param {{ edits: object, createdKeys: object, linkedThisSession: Map<string, Set<string>>,
 *   selection: Set<string>, rowResults: object }} state
 * @param {object[]} results   `results` from the save response
 * @param {string} buildKey
 * @param {{ body?: object, buildName?: string }} [options]  The body sent, for the written values
 * @returns {typeof state}
 */
export function applySaveResults(state, results, buildKey, { body, buildName = 'this Build' } = {}) {
  const edits = { ...state.edits };
  const createdKeys = { ...state.createdKeys };
  const selection = new Set(state.selection);
  const rowResults = { ...state.rowResults };
  const linkedThisSession = new Map(state.linkedThisSession ?? []);
  const linkedNow = new Set(linkedThisSession.get(buildKey) ?? []);

  const sent = new Map();
  for (const item of [...(body?.creates ?? []), ...(body?.updates ?? []), ...(body?.links ?? [])]) {
    sent.set(item.ref, item);
  }
  const sentValues = (ref) => {
    const item = sent.get(ref);
    if (!item || item.material === undefined) return undefined;
    const out = {};
    for (const f of PART_FIELDS) out[f] = item[f];
    if (item.priority !== undefined) out.priority = item.priority;
    return out;
  };

  for (const r of results ?? []) {
    const ref = r.ref;
    const id = r.key ?? ref;
    const failure = r.ok ? null : { error: r.error, field: r.field ?? null };

    if (r.op === 'create') {
      if (r.key) createdKeys[ref] = r.key;
      // The Part holds the sent values unless it already existed and the update failed.
      const written = !!r.key && (r.ok || !r.reused || r.updated);
      const values = written ? sentValues(ref) : undefined;
      if (written) {
        delete edits[ref];
        delete edits[id];
      } else if (id !== ref && edits[ref]) {
        edits[id] = edits[ref];
        delete edits[ref];
      }
      if (id !== ref) delete rowResults[ref];
      selection.delete(ref);
      if (!r.ok) selection.add(id);
      else selection.delete(id);
      rowResults[id] = r.ok
        ? {
          ok: true,
          values,
          note: r.reused && r.updated ? `Already existed; updated and added to ${buildName}.` : null,
        }
        : { ok: false, ...failure, values };
    } else if (r.op === 'update') {
      if (r.ok) {
        delete edits[id];
        selection.delete(id);
        rowResults[id] = { ok: true, values: sentValues(ref), note: null };
      } else {
        rowResults[id] = { ok: false, ...failure };
      }
    } else {
      if (r.ok) {
        selection.delete(id);
        rowResults[id] = { ok: true, note: null };
      } else {
        rowResults[id] = { ok: false, ...failure };
      }
    }

    if (r.ok && r.key && (r.linked || r.alreadyLinked)) linkedNow.add(r.key);
  }

  if (linkedNow.size) linkedThisSession.set(buildKey, linkedNow);
  return { edits, createdKeys, selection, rowResults, linkedThisSession };
}
