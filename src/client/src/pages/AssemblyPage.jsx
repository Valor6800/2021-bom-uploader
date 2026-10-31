import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link, useBlocker, useLocation, useNavigate, useParams, useSearchParams,
} from 'react-router-dom';
import {
  archiveBuild, clonePart, recreatePartForBuild, saveBuildParts,
} from '../api/client.js';
import { useAssemblyData } from '../components/assembly-shared/useAssemblyData.js';
import AssemblyHeader from '../components/assembly-shared/AssemblyHeader.jsx';
import AssemblyLoadError from '../components/assembly-shared/AssemblyLoadError.jsx';
import TwoActiveWarning from '../components/builds/TwoActiveWarning.jsx';
import BuildTabs, { TABPANEL_ID, tabId } from '../components/assembly/BuildTabs.jsx';
import AssemblyPartRow, { COLUMN_COUNT } from '../components/assembly/AssemblyPartRow.jsx';
import BuildCompare from '../components/assembly/BuildCompare.jsx';
import PrintView from '../components/assembly/PrintView.jsx';
import CloneDialog from '../components/assembly/CloneDialog.jsx';
import Alert from '../components/ui/Alert.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import DisclosureMenu from '../components/ui/DisclosureMenu.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import StickySaveBar from '../components/ui/StickySaveBar.jsx';
import { friendlyClause, friendlyError } from '../lib/friendlyError.js';
import {
  buildLabel, currentBuildOf, defaultAssembleBuildKey, dropAgreedStatus, overlayBuildStatus, visibleBuilds,
} from '../lib/buildNames.js';
import {
  addSessionLinks, deriveDesignerRows, dropAgreedLinks, dropAgreedParts, dropAgreedRecreated,
  mergeLinks, mergeParts, newerRevisionOf,
} from '../lib/designerRows.js';
import {
  SAVE_BATCH, applySaveResults, batchBody, bodySize, planSave,
} from '../lib/designerSave.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const NO_SELECTION = new Set();
/** Fields only the Designer changes; this page shows them as text. */
const LOCKED_FIELDS = ['material', 'machinery'];

const emptyWork = () => ({
  edits: {},
  createdKeys: {},
  linkedThisSession: new Map(),
  selection: new Set(),
  rowResults: {},
});

/** Add one Part object to a `Map<key, Part>`; returns a new Map. */
const withPart = (map, part) => (part?.key ? new Map(map).set(part.key, part) : map);

/**
 * The Build to compare the selected one with: the next one up, else the
 * next one down.
 */
function compareDefault(builds, selectedKey) {
  const sel = builds.find((b) => b.key === selectedKey);
  const others = builds.filter((b) => b.key !== selectedKey);
  if (!sel || others.length === 0) return others[0]?.key ?? null;
  const n = sel.buildNumber ?? 0;
  const up = others.filter((b) => (b.buildNumber ?? 0) > n).sort((a, b) => a.buildNumber - b.buildNumber)[0];
  const down = others.filter((b) => (b.buildNumber ?? 0) <= n).sort((a, b) => b.buildNumber - a.buildNumber)[0];
  return (up ?? down)?.key ?? null;
}

/**
 * Assembly page `/a/:key/assemble` (design 3.5): what an assembly student
 * needs for one Assembly. One tab per Build, the Build's Parts with the
 * Parts of other Builds as Move or Re-create candidates, Clone, Archive,
 * Compare and Print. No Cut Version here: that is a CAD decision (Q3).
 *
 * Keyed by the Assembly key, so switching Revision starts clean, and its
 * state is its own (the Designer keeps a separate copy).
 */
export default function AssemblyRoute() {
  const { key } = useParams();
  return <AssemblyPage key={key} assemblyKey={key} />;
}

function AssemblyPage({ assemblyKey: key }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const data = useAssemblyData(key);
  const { assembly } = data;

  const [statusThisSession, setStatusThisSession] = useState(() => new Map());
  const [work, setWork] = useState(emptyWork);
  const [createdParts, setCreatedParts] = useState(() => new Map());
  const [recreated, setRecreated] = useState(() => new Map());
  const [actionBusy, setActionBusy] = useState(null); // { key, kind }
  const [actionMsg, setActionMsg] = useState(null); // { variant, text }
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState(null);
  const [switchTo, setSwitchTo] = useState(null);
  const [wrongBuild, setWrongBuild] = useState(false);
  const [compareKeys, setCompareKeys] = useState(null); // [a, b]
  const keepRef = useRef(null);
  const leaveRef = useRef(null);
  const archiveCancelRef = useRef(null);

  // ----- Builds -----
  const chainBuilds = useMemo(
    () => overlayBuildStatus(data.fetchedBuilds, statusThisSession),
    [data.fetchedBuilds, statusThisSession],
  );
  const allBuilds = useMemo(
    () => visibleBuilds(chainBuilds, key).sort((a, b) => (a.buildNumber ?? 0) - (b.buildNumber ?? 0)),
    [chainBuilds, key],
  );
  // Drafts belong to the designer. Everything on this page (tabs, Compare,
  // Print, the two-Active check, current-Build labels, Move and Re-create
  // targets) sees only the Builds that are ready.
  const builds = useMemo(() => allBuilds.filter((b) => b.status !== 'Draft'), [allBuilds]);
  const requested = searchParams.get('build');
  const view = searchParams.get('view');
  const selectedKey = defaultAssembleBuildKey(builds, requested);
  const selectedBuild = builds.find((b) => b.key === selectedKey) ?? null;
  const buildName = selectedBuild ? buildLabel(selectedBuild) : null;
  const archivedCount = builds.filter((b) => b.status === 'Archived').length;
  const tabBuilds = builds.filter((b) => b.status !== 'Archived' || showArchived || b.key === selectedKey);
  const loadFailed = !!data.secondaryError;
  const locked = !selectedBuild || loadFailed || selectedBuild.status === 'Archived';

  // Overlays end once a re-fetch agrees.
  useEffect(() => {
    setStatusThisSession((prev) => dropAgreedStatus(prev, data.fetchedBuilds));
  }, [data.fetchedBuilds]);
  useEffect(() => {
    setCreatedParts((prev) => dropAgreedParts(prev, data.parts));
    setRecreated((prev) => dropAgreedRecreated(prev, data.parts));
  }, [data.parts]);
  useEffect(() => {
    setWork((w) => {
      const next = dropAgreedLinks(w.linkedThisSession, data.buildParts);
      return next === w.linkedThisSession ? w : { ...w, linkedThisSession: next };
    });
  }, [data.buildParts]);

  const addStatus = useCallback((entries) => {
    if (!entries.length) return;
    setStatusThisSession((prev) => {
      const next = new Map(prev);
      for (const [k, v] of entries) next.set(k, v);
      return next;
    });
  }, []);

  // Pin the default tab into ?build once the list is final, so a status
  // change never moves the student to another Build.
  useEffect(() => {
    if (!data.ready || !selectedKey || requested === selectedKey) return;
    // A Draft is hidden here, not wrong: fall back quietly.
    if (requested && !allBuilds.some((b) => b.key === requested)) setWrongBuild(true);
    const next = new URLSearchParams(searchParams);
    next.set('build', selectedKey);
    setSearchParams(next, { replace: true, state: location.state });
  }, [data.ready, selectedKey, requested, allBuilds, searchParams, setSearchParams, location.state]);

  // ----- Rows -----
  const allParts = useMemo(() => mergeParts(data.parts, createdParts), [data.parts, createdParts]);
  const links = useMemo(
    () => mergeLinks(data.linkedByPart, work.linkedThisSession),
    [data.linkedByPart, work.linkedThisSession],
  );
  const { groups } = useMemo(() => deriveDesignerRows({
    parts: data.parts,
    createdParts,
    chainKeys: data.chain,
    linkedByPart: data.linkedByPart,
    linkedThisSession: work.linkedThisSession,
    buildKey: selectedKey,
    builds,
    edits: work.edits,
    rowResults: work.rowResults,
  }), [data.parts, createdParts, data.chain, data.linkedByPart, work, selectedKey, builds]);

  // Saves always carry the stored Material and Machinery, never an edit.
  const saveGroups = useMemo(() => ({
    newFromCad: [],
    inBuild: groups.inBuild.map((r) => ({
      ...r,
      values: { ...r.values, ...Object.fromEntries(LOCKED_FIELDS.map((f) => [f, r.stored[f]])) },
    })),
    other: [],
  }), [groups.inBuild]);
  const plan = useMemo(
    () => (locked ? { body: { creates: [], updates: [], links: [] }, heldBack: [] } : planSave(saveGroups, NO_SELECTION)),
    [locked, saveGroups],
  );
  const heldBack = useMemo(() => new Map(plan.heldBack.map((h) => [h.rowId, h])), [plan]);
  const pendingCount = bodySize(plan.body) + plan.heldBack.length;
  const hasPending = pendingCount > 0;

  // ----- Unsaved-changes guard: path changes only, plus closing the tab -----
  const blocker = useBlocker(useCallback(
    ({ currentLocation, nextLocation }) => hasPending && currentLocation.pathname !== nextLocation.pathname,
    [hasPending],
  ));
  useEffect(() => {
    if (!hasPending) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasPending]);

  // ----- Navigation within the page -----
  const setParams = useCallback((changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === undefined) next.delete(k); else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectBuild = useCallback((buildKey) => {
    setActionMsg(null);
    setWrongBuild(false);
    setCompareKeys(null);
    setParams({ build: buildKey });
  }, [setParams]);

  const onPick = (buildKey) => {
    if (buildKey === selectedKey) return;
    if (hasPending) setSwitchTo(buildKey);
    else selectBuild(buildKey);
  };

  const viewUrl = (v) => {
    const next = new URLSearchParams();
    if (selectedKey) next.set('build', selectedKey);
    if (v) next.set('view', v);
    return `?${next}`;
  };

  // ----- Save -----
  const save = useCallback(async (only) => {
    if (!selectedKey) return;
    const { body } = only ? planSave(saveGroups, NO_SELECTION, { only }) : plan;
    const total = bodySize(body);
    if (total === 0) return;
    setSaving(true);
    setSaveError(null);
    let done = 0;
    for (const batch of batchBody(body, SAVE_BATCH)) {
      if (total > SAVE_BATCH) setSaveProgress(`Saving ${done}/${total}…`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await saveBuildParts(selectedKey, batch);
        setWork((w) => applySaveResults(w, res.results, selectedKey, { body: batch, buildName }));
        done += bodySize(batch);
      } catch (err) {
        setSaveError(done === 0
          ? `Couldn't save: ${friendlyClause(err)} Nothing was changed.`
          : `Couldn't save the last ${total - done}: ${friendlyClause(err)} Those changes are still here.`);
        break;
      }
    }
    setSaving(false);
    setSaveProgress(null);
    await data.refresh();
  }, [selectedKey, saveGroups, plan, buildName, data]);

  const discard = useCallback(() => {
    setWork((w) => ({ ...w, edits: {}, rowResults: {} }));
    setSaveError(null);
  }, []);

  const onEdit = (rowId, field, value) => {
    if (LOCKED_FIELDS.includes(field)) return;
    setWork((w) => ({
      ...w,
      edits: { ...w.edits, [rowId]: { ...(w.edits[rowId] ?? {}), [field]: value } },
    }));
  };

  // ----- Move and Re-create -----
  const linkInSession = (buildKey, partKey) => setWork((w) => ({
    ...w,
    linkedThisSession: addSessionLinks(w.linkedThisSession, buildKey, [partKey]),
  }));

  const move = async (row) => {
    if (!selectedKey) return;
    const target = selectedKey;
    const name = buildName;
    setActionBusy({ key: row.key, kind: 'move' });
    setActionMsg(null);
    try {
      const res = await saveBuildParts(target, { links: [{ ref: row.key, key: row.key }] });
      const result = res.results?.[0];
      if (result?.ok) {
        linkInSession(target, row.key);
        setActionMsg({ variant: 'info', text: `Moved ${row.key} to ${name}.` });
      } else {
        setActionMsg({ variant: 'error', text: `Couldn't move ${row.key} to ${name}: ${result?.error ?? 'no result came back.'}` });
      }
      data.refresh();
    } catch (err) {
      setActionMsg({ variant: 'error', text: `Couldn't move ${row.key} to ${name}: ${friendlyClause(err)}` });
    } finally {
      setActionBusy(null);
    }
  };

  const recreate = async (row) => {
    if (!selectedKey) return;
    const target = selectedKey;
    const name = buildName;
    setActionBusy({ key: row.key, kind: 'recreate' });
    setActionMsg(null);
    try {
      const res = await recreatePartForBuild(target, row.key);
      setCreatedParts((prev) => withPart(prev, res.part));
      linkInSession(target, res.key);
      setRecreated((prev) => new Map(prev).set(row.key, res.key));
      setActionMsg({ variant: 'info', text: `Re-created ${row.key} as ${res.key} (Revision ${res.revision}) in ${name}.` });
      data.refresh();
    } catch (err) {
      const body = err?.body ?? {};
      if (err?.status === 409 && body.recreatedAs) {
        setRecreated((prev) => new Map(prev).set(row.key, body.recreatedAs));
        setActionMsg({ variant: 'error', text: friendlyError(err) });
        data.refresh();
      } else if ((body.stage === 'revises-link' || body.stage === 'used-in-link') && body.key) {
        setCreatedParts((prev) => withPart(prev, body.part));
        setRecreated((prev) => new Map(prev).set(row.key, body.key));
        setActionMsg({
          variant: 'error',
          text: body.stage === 'revises-link'
            ? `Created ${body.key}, but couldn't record it as the next Revision of ${row.key}: ${friendlyClause(err)}`
            : `Created ${body.key}, but couldn't add it to ${name}: ${friendlyClause(err)} Move it here to add it.`,
        });
        data.refresh();
      } else {
        setActionMsg({ variant: 'error', text: `Couldn't re-create ${row.key} for ${name}: ${friendlyClause(err)}` });
      }
    } finally {
      setActionBusy(null);
    }
  };

  /** Why "Re-create here" is off for this Part, or null. */
  const recreateBlocked = (row) => {
    const part = allParts.find((p) => p.key === row.key);
    const newer = part ? newerRevisionOf(part, allParts) : null;
    if (newer) return `Already re-created as ${newer.key}. Re-create ${newer.key} instead.`;
    const session = recreated.get(row.key);
    return session ? `Already re-created as ${session}` : null;
  };

  // ----- Clone -----
  const cloneSources = useMemo(() => {
    const chain = new Set(data.chain);
    return allParts
      .filter((p) => chain.has(p.epic))
      .sort((a, b) => (a.fullPartNumber ?? a.summary).localeCompare(b.fullPartNumber ?? b.summary));
  }, [allParts, data.chain]);

  const clone = async ({ sourceKey, name, quantity }) => {
    setCloneBusy(true);
    setCloneError(null);
    try {
      const res = await clonePart(sourceKey, { epicKey: key, name, quantity });
      setCreatedParts((prev) => withPart(prev, res.part));
      const number = res.part?.fullPartNumber ?? res.fullPartNumber;
      setActionMsg({
        variant: 'info',
        text: `Cloned as ${res.key} (${number}). It's listed under Parts in other Builds; Move it here to add it.`,
      });
      setCloneOpen(false);
      data.refresh();
    } catch (err) {
      setCloneError(`Couldn't clone the Part: ${friendlyClause(err)}`);
    } finally {
      setCloneBusy(false);
    }
  };

  // ----- Archive -----
  const confirmArchive = async () => {
    if (!selectedBuild) return;
    const label = buildName;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await archiveBuild(selectedBuild.key);
      addStatus([[selectedBuild.key, { status: 'Archived' }]]);
      setArchiveOpen(false);
      setActionMsg({ variant: 'info', text: `${label} is archived.` });
      data.refresh();
    } catch (err) {
      const text = `Couldn't archive ${label}: ${friendlyClause(err)}`;
      setArchiveError(text);
      setActionMsg({ variant: 'error', text });
    } finally {
      setArchiveBusy(false);
    }
  };

  const onRevisionChange = (revKey) => navigate(`/a/${encodeURIComponent(revKey)}/assemble`);

  // ----- Render: whole-page states -----
  if (data.assemblyError) {
    return <AssemblyLoadError assemblyKey={key} error={data.assemblyError} onRetry={data.reloadAll} />;
  }
  if (!assembly) {
    return <p className="page-loading" role="status">Loading the Assembly…</p>;
  }

  const inBuildParts = groups.inBuild.map((r) => ({ key: r.key, summary: r.summary, ...r.stored }));
  const actionsLocked = !!actionBusy || loadFailed || !selectedBuild || selectedBuild.status === 'Archived';

  let body;
  if (!data.ready) {
    body = <p className="page-loading" role="status">Loading Builds and Parts…</p>;
  } else if (view === 'compare' && builds.length > 0) {
    // A picked pair holds only while both Builds are still listed here.
    const shown = (k) => builds.some((x) => x.key === k);
    const [a, b] = compareKeys && compareKeys.every(shown)
      ? compareKeys
      : [selectedKey, compareDefault(builds, selectedKey)];
    body = (
      <BuildCompare
        builds={builds}
        parts={allParts}
        links={links}
        aKey={a}
        bKey={b}
        onChange={(na, nb) => setCompareKeys([na, nb])}
        backTo={viewUrl(null)}
      />
    );
  } else if (view === 'print' && selectedBuild) {
    body = <PrintView assembly={assembly} build={selectedBuild} parts={inBuildParts} backTo={viewUrl(null)} />;
  } else {
    body = (
      <>
        {builds.length > 0 && (
          <div className="build-tabs-row no-print">
            <h2 className="build-picker-label">Builds</h2>
            <BuildTabs
              builds={tabBuilds}
              selectedKey={selectedKey}
              onSelect={onPick}
              archivedCount={archivedCount}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((s) => !s)}
              disabled={loadFailed}
            />
          </div>
        )}

        {!selectedBuild && !loadFailed ? (
          <EmptyState
            title={allBuilds.length === 0 ? 'No Builds yet' : 'No Build is ready yet'}
            action={<Link to={`/a/${encodeURIComponent(key)}/design`} className="btn btn-primary">Open Designer</Link>}
          />
        ) : selectedBuild && (
          <section
            className="build-panel"
            id={TABPANEL_ID}
            role="tabpanel"
            aria-labelledby={tabId(selectedBuild.key)}
          >
            <div className="build-panel-header">
              <h2 className="build-panel-title">
                {buildName} <span aria-hidden="true">·</span> <Badge status={selectedBuild.status} />
              </h2>
              <div className="build-panel-actions">
                {selectedBuild.onshapeVersionLink && (
                  <a
                    href={selectedBuild.onshapeVersionLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary"
                  >
                    OnShape version <span aria-hidden="true">↗</span>
                  </a>
                )}
                {builds.length > 1 && (
                  <Link to={viewUrl('compare')} className="btn btn-secondary">
                    <span aria-hidden="true">⇄ </span>Compare
                  </Link>
                )}
                <Link to={viewUrl('print')} className="btn btn-secondary">
                  <span aria-hidden="true">🖨 </span>Print
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => { setCloneError(null); setCloneOpen(true); }}
                  ariaDisabled={selectedBuild.status === 'Archived'}
                  disabled={loadFailed || cloneSources.length === 0}
                  title={selectedBuild.status === 'Archived' ? "This Build is archived and can't be changed." : undefined}
                >
                  Clone a Part
                </Button>
                {selectedBuild.status !== 'Archived' && (
                  <DisclosureMenu label={`More actions for ${buildName}`}>
                    {(close) => (
                      <Button
                        variant="danger"
                        onClick={() => { close(); setArchiveError(null); setArchiveOpen(true); }}
                        disabled={loadFailed}
                      >
                        Archive Build
                      </Button>
                    )}
                  </DisclosureMenu>
                )}
              </div>
            </div>

            {selectedBuild.status === 'Archived' && (
              <p className="draft-line">Archived: this Build is a dead end and can&apos;t be changed.</p>
            )}

            {actionMsg && (
              <Alert variant={actionMsg.variant} role={actionMsg.variant === 'error' ? 'alert' : 'status'}>
                {actionMsg.text}
              </Alert>
            )}

            <TwoActiveWarning
              builds={builds}
              cutFailedKey={null}
              documentId={assembly.documentId}
              assemblyKey={key}
              onStatus={addStatus}
              onResolved={() => data.refresh()}
            />

            <div className="parts-table-wrap">
              <table className="table parts-table assembly-table">
                <caption className="visually-hidden">Parts for {buildName}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="cell-part">Part</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Material</th>
                    <th scope="col">Machinery</th>
                    <th scope="col">Powdercoat</th>
                    <th scope="col">Thickness</th>
                    <th scope="col">Current?</th>
                  </tr>
                </thead>
                <tbody className="parts-group parts-group-in">
                  <tr className="group-row">
                    <th scope="colgroup" colSpan={COLUMN_COUNT}>
                      <span className="group-title">In {buildName}</span>
                      <span className="group-count">{groups.inBuild.length}</span>
                    </th>
                  </tr>
                  {groups.inBuild.length === 0 && (
                    <tr>
                      <td colSpan={COLUMN_COUNT} className="table-empty">
                        No Parts in {buildName} yet. Move them here from other Builds below.
                      </td>
                    </tr>
                  )}
                  {groups.inBuild.map((row) => {
                    const cur = currentBuildOf(row.buildKeys, builds);
                    const current = cur && cur.key !== selectedKey
                      ? { current: false, label: `${buildLabel(cur)} is newer` }
                      : { current: true, label: 'Current' };
                    return (
                      <AssemblyPartRow
                        key={row.rowId}
                        row={row}
                        inBuild
                        buildName={buildName}
                        current={current}
                        problem={heldBack.get(row.rowId) ?? null}
                        editable={!locked && !row.readOnly}
                        saving={saving}
                        onEdit={(field, value) => onEdit(row.rowId, field, value)}
                        onRetry={() => save(new Set([row.rowId]))}
                      />
                    );
                  })}
                </tbody>
                {groups.other.length > 0 && (
                  <tbody className="parts-group parts-group-other">
                    <tr className="group-row">
                      <th scope="colgroup" colSpan={COLUMN_COUNT}>
                        <span className="group-title">Parts in other Builds, not in {buildName}</span>
                        <span className="group-count">{groups.other.length}</span>
                      </th>
                    </tr>
                    {groups.other.map((row) => (
                      <AssemblyPartRow
                        key={row.rowId}
                        row={row}
                        inBuild={false}
                        buildName={buildName}
                        editable={false}
                        saving={saving}
                        onMove={() => move(row)}
                        onRecreate={() => recreate(row)}
                        actionBusy={actionBusy?.key === row.key ? actionBusy.kind : null}
                        actionsLocked={actionsLocked}
                        recreateBlocked={recreateBlocked(row)}
                      />
                    ))}
                  </tbody>
                )}
              </table>
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <div className={`work-page assembly-page${view === 'print' ? ' assembly-page-print' : ''}`}>
      <div className={view === 'print' ? 'no-print' : undefined}>
        <AssemblyHeader
          assembly={assembly}
          revisions={data.revisions}
          mode="assemble"
          buildKey={selectedKey}
          onRevisionChange={onRevisionChange}
        />
      </div>

      {wrongBuild && (
        <Alert variant="info" role="status">
          That Build isn&apos;t part of this Assembly{selectedBuild ? `; showing ${buildName}` : ''}.
        </Alert>
      )}

      {loadFailed && (
        <Alert
          variant="warning"
          role="status"
          actions={<Button variant="secondary" onClick={data.reloadAll}>Retry</Button>}
        >
          Couldn&apos;t load {data.secondaryError.what}: {friendlyClause(data.secondaryError.err)}
        </Alert>
      )}

      {body}

      {(hasPending || saving || saveError) && view !== 'print' && (
        <StickySaveBar
          summary={`Unsaved: ${plural(plan.body.updates.length + plan.heldBack.length, 'change', 'changes')}`}
          status={saveProgress
            ?? (plan.heldBack.length
              ? `${plural(plan.heldBack.length, 'row needs', 'rows need')} a fix before it can save.${bodySize(plan.body) === 0 ? ' Fix the marked rows to save.' : ''}`
              : null)}
          alert={saveError ? <Alert variant="error" role="alert">{saveError}</Alert> : null}
          actions={(
            <>
              <Button variant="secondary" onClick={discard} disabled={saving}>Discard</Button>
              <Button variant="primary" onClick={() => save()} disabled={saving || bodySize(plan.body) === 0}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        />
      )}

      <CloneDialog
        open={cloneOpen}
        parts={cloneSources}
        busy={cloneBusy}
        error={cloneError}
        onClone={clone}
        onClose={() => setCloneOpen(false)}
      />

      <Dialog
        open={archiveOpen}
        onClose={() => { if (!archiveBusy) setArchiveOpen(false); }}
        closeDisabled={archiveBusy}
        title={`Archive ${buildName ?? 'this Build'}?`}
        initialFocusRef={archiveCancelRef}
        footer={(
          <>
            <Button ref={archiveCancelRef} variant="secondary" onClick={() => setArchiveOpen(false)} disabled={archiveBusy}>
              Cancel
            </Button>
            <Button variant="danger-solid" onClick={confirmArchive} disabled={archiveBusy}>
              {archiveBusy ? 'Archiving…' : 'Archive Build'}
            </Button>
          </>
        )}
      >
        <p>It will be hidden from the Build list and marked as a dead end. This can&apos;t be undone from ValorBOM.</p>
        {archiveError && <p className="form-error" role="alert">{archiveError}</p>}
      </Dialog>

      <Dialog
        open={!!switchTo}
        onClose={() => setSwitchTo(null)}
        title={`Discard ${plural(pendingCount, 'unsaved change', 'unsaved changes')}?`}
        initialFocusRef={keepRef}
        footer={(
          <>
            <Button ref={keepRef} variant="secondary" onClick={() => setSwitchTo(null)}>Keep editing</Button>
            <Button
              variant="danger-solid"
              onClick={() => { const k = switchTo; setSwitchTo(null); discard(); selectBuild(k); }}
            >
              Discard and switch
            </Button>
          </>
        )}
      >
        <p>Switching Build drops the changes you haven&apos;t saved.</p>
      </Dialog>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        initialFocusRef={leaveRef}
        footer={(
          <>
            <Button ref={leaveRef} variant="secondary" onClick={() => blocker.reset?.()}>Stay</Button>
            <Button variant="danger-solid" onClick={() => blocker.proceed?.()}>Leave</Button>
          </>
        )}
      >
        <p>{plural(pendingCount, 'unsaved change', 'unsaved changes')} will be lost.</p>
      </Dialog>
    </div>
  );
}
