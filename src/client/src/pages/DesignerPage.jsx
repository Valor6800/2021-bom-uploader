import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useBlocker, useLocation, useNavigate, useParams, useSearchParams,
} from 'react-router-dom';
import {
  createBuild, cutBuildVersion, previewParts, recreatePartForBuild, saveBuildParts,
} from '../api/client.js';
import { useAssemblyData } from '../components/assembly-shared/useAssemblyData.js';
import AssemblyHeader from '../components/assembly-shared/AssemblyHeader.jsx';
import AssemblyLoadError from '../components/assembly-shared/AssemblyLoadError.jsx';
import BuildPicker from '../components/builds/BuildPicker.jsx';
import NewBuildForm from '../components/builds/NewBuildForm.jsx';
import CutVersionDialog from '../components/builds/CutVersionDialog.jsx';
import TwoActiveWarning from '../components/builds/TwoActiveWarning.jsx';
import DesignerPartsTable from '../components/designer/DesignerPartsTable.jsx';
import UnidentifiedPartsWarning from '../components/parts/UnidentifiedPartsWarning.jsx';
import SubAssemblyList from '../components/home/SubAssemblyList.jsx';
import SubAssemblyLinks from '../components/assembly-shared/SubAssemblyLinks.jsx';
import Alert from '../components/ui/Alert.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import StickySaveBar from '../components/ui/StickySaveBar.jsx';
import { friendlyClause, friendlyError } from '../lib/friendlyError.js';
import {
  buildLabel, cutErrorEntries, cutResultEntries, defaultBuildKey, dropAgreedStatus, listLabels,
  mergeBuilds, nextBuildNumber, overlayBuildStatus, pickerBuilds, visibleBuilds,
} from '../lib/buildNames.js';
import {
  PART_FIELDS, addSessionLinks, deriveDesignerRows, dropAgreedLinks, dropAgreedParts, dropAgreedRecreated,
  mergeParts, newerRevisionOf,
} from '../lib/designerRows.js';
import {
  SAVE_BATCH, applySaveResults, batchBody, bodySize, planSave, saveCounts,
} from '../lib/designerSave.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Part objects for the creates a save made, built from the CAD row and the
 * values sent, so a created Part keeps its row after Discard clears the
 * preview and before search lists it.
 */
function addCreatedParts(prev, results, batch, preview, assemblyKey) {
  const made = (results ?? []).filter((r) => r.op === 'create' && r.key);
  if (!made.length) return prev;
  const next = new Map(prev);
  for (const r of made) {
    const item = (preview?.newParts ?? []).find((p) => p.fullPartNumber === r.ref);
    if (!item) continue;
    const sentItem = batch.creates.find((c) => c.ref === r.ref);
    const written = r.ok || !r.reused || r.updated;
    const values = {};
    if (sentItem && written) for (const f of PART_FIELDS) values[f] = sentItem[f];
    next.set(r.key, { ...item, ...values, key: r.key, epic: assemblyKey });
  }
  return next;
}

/** Add one Part object to a `Map<key, Part>`; returns a new Map. */
const withPart = (map, part) => (part?.key ? new Map(map).set(part.key, part) : map);

const emptyWork = () => ({
  edits: {},
  createdKeys: {},
  linkedThisSession: new Map(),
  selection: new Set(),
  rowResults: {},
});

/**
 * Designer page `/a/:key/design` (design 3.4): everything a CAD student
 * needs for one Assembly on one page. Keyed by the Assembly key, so
 * switching Revision starts from a clean state.
 */
export default function DesignerRoute() {
  const { key } = useParams();
  return <DesignerPage key={key} assemblyKey={key} />;
}

function DesignerPage({ assemblyKey: key }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const onboard = location.state?.onboard ?? null;

  // Builds this session knows about before search does (onboarding's Build 1, new Builds).
  const [sessionBuilds, setSessionBuilds] = useState(() => (onboard?.build ? [onboard.build] : []));
  const data = useAssemblyData(key, { extraBuilds: sessionBuilds });
  const { assembly } = data;

  const [statusThisSession, setStatusThisSession] = useState(() => new Map());
  const [cutFailedKey, setCutFailedKey] = useState(null);
  const [work, setWork] = useState(emptyWork);
  // Parts this session created, so their rows outlive the preview (Discard).
  const [createdParts, setCreatedParts] = useState(() => new Map());
  const [preview, setPreview] = useState(null);
  const [cadBusy, setCadBusy] = useState(false);
  const [cadError, setCadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newStart, setNewStart] = useState('empty'); // 'copy' from "New Build from this one"
  const [recreated, setRecreated] = useState(() => new Map());
  const [recreatingKey, setRecreatingKey] = useState(null);
  const [actionMsg, setActionMsg] = useState(null); // { variant, text }
  const [createBusy, setCreateBusy] = useState(null); // 'form' | 'empty'
  const [newError, setNewError] = useState(null);
  const [emptyError, setEmptyError] = useState(null);
  const [buildWarning, setBuildWarning] = useState(null);
  const [cutOpen, setCutOpen] = useState(false);
  const [cutBusy, setCutBusy] = useState(false);
  const [cutError, setCutError] = useState(null);
  const [cutAlreadyCut, setCutAlreadyCut] = useState(false);
  const [switchTo, setSwitchTo] = useState(null);
  const [showAlreadyAdded, setShowAlreadyAdded] = useState(!!onboard?.alreadyAdded);
  const [wrongBuild, setWrongBuild] = useState(false);
  const cadRunRef = useRef(false);
  const keepRef = useRef(null);
  const leaveRef = useRef(null);

  // ----- Builds: merged with this session's, overlaid with known statuses -----
  const chainBuilds = useMemo(
    () => overlayBuildStatus(mergeBuilds(data.fetchedBuilds, sessionBuilds), statusThisSession),
    [data.fetchedBuilds, sessionBuilds, statusThisSession],
  );
  const builds = useMemo(() => visibleBuilds(chainBuilds, key), [chainBuilds, key]);
  const requested = searchParams.get('build');
  const selectedKey = defaultBuildKey(builds, requested);
  const selectedBuild = builds.find((b) => b.key === selectedKey) ?? null;
  const buildName = selectedBuild ? buildLabel(selectedBuild) : null;
  const nextNumber = nextBuildNumber(builds);
  const hasIds = !!(assembly?.documentId && assembly?.workspaceId && assembly?.elementId);
  const loadFailed = !!data.secondaryError;
  // A cut Build never changes: it is shown view-only.
  const viewOnly = !!selectedBuild && selectedBuild.status !== 'Draft';
  const locked = !selectedBuild || loadFailed || viewOnly;

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

  // ----- Rows and the pending save -----
  const { groups } = useMemo(() => deriveDesignerRows({
    parts: data.parts,
    createdParts,
    chainKeys: data.chain,
    linkedByPart: data.linkedByPart,
    linkedThisSession: work.linkedThisSession,
    buildKey: selectedKey,
    builds,
    preview,
    edits: work.edits,
    createdKeys: work.createdKeys,
    rowResults: work.rowResults,
  }), [data.parts, createdParts, data.chain, data.linkedByPart, work, selectedKey, builds, preview]);

  const plan = useMemo(
    () => (locked ? { body: { creates: [], updates: [], links: [] }, heldBack: [] } : planSave(groups, work.selection)),
    [locked, groups, work.selection],
  );
  const heldBack = useMemo(() => new Map(plan.heldBack.map((h) => [h.rowId, h])), [plan]);
  const pendingCount = bodySize(plan.body) + plan.heldBack.length;
  const hasPending = pendingCount > 0;
  const counts = saveCounts(plan.body);

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

  // ----- Update from CAD -----
  const runCad = useCallback(async ({ fresh }) => {
    if (!assembly) return;
    setCadBusy(true);
    setCadError(null);
    try {
      const result = await previewParts({
        epicKey: key,
        documentId: assembly.documentId,
        workspaceId: assembly.workspaceId,
        elementId: assembly.elementId,
        ...(fresh ? { fresh: true } : {}),
      });
      setPreview(result);
      setWork((w) => {
        const selection = new Set(w.selection);
        for (const item of result.newParts ?? []) {
          if (!w.createdKeys[item.fullPartNumber]) selection.add(item.fullPartNumber);
        }
        return { ...w, selection };
      });
    } catch (err) {
      setCadError(`Couldn't read Parts from CAD: ${friendlyClause(err)}`);
    } finally {
      setCadBusy(false);
    }
  }, [assembly, key]);

  // `cad=1` runs Update from CAD once, after the Build list is final. The
  // ref is set and the parameter stripped before the request, so
  // StrictMode's second effect run doesn't send a second preview.
  useEffect(() => {
    if (!data.ready || !assembly || cadRunRef.current) return;
    if (searchParams.get('cad') !== '1') return;
    cadRunRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('cad');
    if (selectedKey) next.set('build', selectedKey);
    setSearchParams(next, { replace: true, state: location.state });
    if (selectedKey && hasIds && !viewOnly) runCad({ fresh: false });
  }, [data.ready, assembly, searchParams, setSearchParams, location.state, selectedKey, hasIds, viewOnly, runCad]);

  // Pin the default selection into ?build once the list is final, so a
  // status change (a cut, a lagging re-fetch) never moves the student to
  // another Build. A requested Build that isn't in the list is reported.
  useEffect(() => {
    if (!data.ready || !selectedKey || requested === selectedKey) return;
    if (searchParams.get('cad') === '1') return;
    if (requested) setWrongBuild(true);
    const next = new URLSearchParams(searchParams);
    next.set('build', selectedKey);
    setSearchParams(next, { replace: true, state: location.state });
  }, [data.ready, selectedKey, requested, searchParams, setSearchParams, location.state]);

  // ----- Save -----
  const save = useCallback(async (only) => {
    if (!selectedKey) return;
    const { body } = only ? planSave(groups, work.selection, { only }) : plan;
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
        setCreatedParts((prev) => addCreatedParts(prev, res.results, batch, preview, key));
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
  }, [selectedKey, groups, work.selection, plan, buildName, data, preview, key]);

  const discard = useCallback(() => {
    setWork((w) => ({ ...w, edits: {}, selection: new Set(), rowResults: {} }));
    setPreview(null);
    setSaveError(null);
  }, []);

  // ----- Re-create a Part a cut Build uses, for this Draft -----
  const recreate = async (row) => {
    if (!selectedKey) return;
    const target = selectedKey;
    const name = buildName;
    setRecreatingKey(row.key);
    setActionMsg(null);
    try {
      const res = await recreatePartForBuild(target, row.key);
      setCreatedParts((prev) => withPart(prev, res.part));
      setWork((w) => ({ ...w, linkedThisSession: addSessionLinks(w.linkedThisSession, target, [res.key]) }));
      setRecreated((prev) => new Map(prev).set(row.key, res.key));
      setActionMsg({ variant: 'info', text: `Re-created ${row.key} as ${res.key} (Revision ${res.revision}) in ${name}. OnShape still shows Revision ${row.version ?? 'A'}; raise it there to match.` });
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
            : `Created ${body.key}, but couldn't add it to ${name}: ${friendlyClause(err)} Tick it under Other Parts to add it.`,
        });
        data.refresh();
      } else {
        setActionMsg({ variant: 'error', text: `Couldn't re-create ${row.key} for ${name}: ${friendlyClause(err)}` });
      }
    } finally {
      setRecreatingKey(null);
    }
  };

  const allParts = useMemo(() => mergeParts(data.parts, createdParts), [data.parts, createdParts]);
  /** Why "Re-create for this Build" is off for this Part, or null. */
  const recreateBlocked = (row) => {
    const part = allParts.find((p) => p.key === row.key);
    const newer = part ? newerRevisionOf(part, allParts) : null;
    if (newer) return `Already re-created as ${newer.key}`;
    const session = recreated.get(row.key);
    return session ? `Already re-created as ${session}` : null;
  };

  // ----- Builds: select, create -----
  const selectBuild = useCallback((buildKey) => {
    setWrongBuild(false);
    setActionMsg(null);
    const next = new URLSearchParams(searchParams);
    next.set('build', buildKey);
    next.delete('cad');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const onPick = (buildKey) => {
    if (buildKey === selectedKey) return;
    if (hasPending) setSwitchTo(buildKey);
    else selectBuild(buildKey);
  };

  const create = async ({ name, description = '', cloneFromBuildKey }, where) => {
    const setError = where === 'empty' ? setEmptyError : setNewError;
    setCreateBusy(where);
    setError(null);
    setBuildWarning(null);
    try {
      const res = await createBuild({
        assemblyKey: key,
        revisionChainKeys: data.chain,
        name,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(cloneFromBuildKey ? { cloneFromBuildKey } : {}),
      });
      const { build } = res;
      setSessionBuilds((prev) => [...prev, build]);
      if (res.linked?.length) {
        setWork((w) => ({ ...w, linkedThisSession: addSessionLinks(w.linkedThisSession, build.key, res.linked) }));
      }
      const label = buildLabel(build);
      if (res.cloneError) {
        setBuildWarning(`${label} was created, but its Parts couldn't be copied: ${res.cloneError}.`);
      } else if (res.failed?.length) {
        setBuildWarning(`${label} was created, but ${plural(res.failed.length, "Part wasn't", "Parts weren't")} copied: ${res.failed.map((f) => f.partKey).join(', ')}. Add them from Other Parts in this Assembly.`);
      }
      setNewOpen(false);
      if (onboard?.buildError) {
        navigate(`${location.pathname}?build=${encodeURIComponent(build.key)}`, { replace: true, state: null });
      } else {
        selectBuild(build.key);
      }
      data.refresh();
    } catch (err) {
      setError(`Couldn't create Build ${nextNumber}: ${friendlyClause(err)}`);
    } finally {
      setCreateBusy(null);
    }
  };

  // ----- Cut Version -----
  const toSupersede = builds.filter((b) => b.status === 'Active' && b.key !== selectedKey);

  const openCut = () => {
    setCutError(null);
    setCutAlreadyCut(false);
    setCutOpen(true);
  };

  const confirmCut = async () => {
    if (!selectedBuild) return;
    const label = buildLabel(selectedBuild);
    const others = toSupersede.length ? listLabels(toSupersede) : 'an older Build';
    setCutBusy(true);
    setCutError(null);
    try {
      const result = await cutBuildVersion(selectedBuild.key, { assemblyKey: key });
      addStatus(cutResultEntries(selectedBuild.key, result));
      setCutFailedKey(null);
      setCutOpen(false);
      data.refresh();
    } catch (err) {
      addStatus(cutErrorEntries(selectedBuild.key, err));
      if (err?.status === 409) {
        setCutAlreadyCut(true);
        setCutError(`${label} has already been cut.`);
        data.refresh();
      } else {
        const why = friendlyClause(err);
        const stage = err?.body?.cutStage;
        if (stage === 'link') {
          setCutError(`The OnShape version was made, but ${label} couldn't be updated: ${why} Try again.`);
        } else if (stage === 'transition') {
          setCutError(`The OnShape version was made, but ${label} couldn't be marked Active: ${why} Try again; it will reuse that version.`);
        } else if (stage === 'supersede') {
          setCutFailedKey(selectedBuild.key);
          setCutError(`${label} is now Active, but ${others} couldn't be marked Superseded: ${why} Try again to finish; it won't make a new version.`);
        } else {
          setCutError(`Couldn't cut the version: ${why}`);
        }
      }
    } finally {
      setCutBusy(false);
    }
  };

  // ----- Row handlers -----
  const onToggle = (rowId, checked) => setWork((w) => {
    const selection = new Set(w.selection);
    if (checked) selection.add(rowId); else selection.delete(rowId);
    return { ...w, selection };
  });
  const onToggleAll = (rowIds, checked) => setWork((w) => {
    const selection = new Set(w.selection);
    for (const id of rowIds) { if (checked) selection.add(id); else selection.delete(id); }
    return { ...w, selection };
  });
  const onEdit = (rowId, field, value) => setWork((w) => ({
    ...w,
    edits: { ...w.edits, [rowId]: { ...(w.edits[rowId] ?? {}), [field]: value } },
  }));
  const onRetry = (rowId) => save(new Set([rowId]));

  const onRevisionChange = (revKey) => navigate(`/a/${encodeURIComponent(revKey)}/design`);

  // ----- Render: whole-page states -----
  if (data.assemblyError) {
    return <AssemblyLoadError assemblyKey={key} error={data.assemblyError} onRetry={data.reloadAll} />;
  }
  if (!assembly) {
    return <p className="page-loading" role="status">Loading the Assembly…</p>;
  }

  const cadDisabledReason = !selectedBuild
    ? 'Create Build 1 first.'
    : !hasIds
      ? 'This Assembly has no OnShape link.'
      : loadFailed
        ? 'Reload the missing data first.'
        : null;
  const cutDisabledReason = !hasIds
      ? 'This Assembly has no OnShape link.'
      : loadFailed
        ? 'Reload the missing data first.'
        : null;
  const pickerList = pickerBuilds(builds, selectedKey)
    .sort((a, b) => (a.buildNumber ?? 0) - (b.buildNumber ?? 0));
  const hasAnyParts = groups.inBuild.length + groups.other.length + groups.newFromCad.length > 0;

  return (
    <div className="work-page designer-page">
      <AssemblyHeader
        assembly={assembly}
        revisions={data.revisions}
        mode="design"
        buildKey={selectedKey}
        onRevisionChange={onRevisionChange}
      />

      <SubAssemblyLinks assemblyKey={key} mode="design" />

      {showAlreadyAdded && (
        <Alert
          variant="info"
          role="status"
          actions={<Button variant="ghost" onClick={() => setShowAlreadyAdded(false)} aria-label="Dismiss">×</Button>}
        >
          Already added; opened it.
        </Alert>
      )}

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

      <BuildPicker
        builds={pickerList}
        selectedKey={selectedKey}
        onSelect={onPick}
        onNew={() => { setNewError(null); setNewStart('empty'); setNewOpen((o) => !o); }}
        disabled={loadFailed || !data.ready}
        newDisabled={!!createBusy}
        newOpen={newOpen}
      />

      {newOpen && (
        <NewBuildForm
          key={newStart}
          defaultName={assembly.name}
          nextNumber={nextNumber}
          copyFrom={builds.filter((b) => b.status !== 'Archived' || b.key === selectedKey)}
          defaultCopyKey={selectedKey}
          defaultStart={newStart}
          busy={createBusy === 'form'}
          error={newError}
          onCreate={(values) => create(values, 'form')}
          onCancel={() => setNewOpen(false)}
        />
      )}


      {onboard?.revisionLinkError && (
        <Alert variant="warning" role="alert" className="onboard-banner">
          {assembly.summary} was created, but it couldn&apos;t be recorded as the next Revision of{' '}
          {onboard.revisionOf?.summary ?? 'the earlier Assembly'}: {onboard.revisionLinkError}. Its Parts and Builds
          won&apos;t show the earlier Revision until that link exists.
        </Alert>
      )}

      {onboard?.subAssemblies?.length > 0 && (
        <Alert
          variant={onboard.subAssemblies.some((s) => s.status === 'error' || s.status === 'conflict' || s.status === 'problems') ? 'warning' : 'info'}
          role="status"
          className="onboard-banner"
        >
          <SubAssemblyList subAssemblies={onboard.subAssemblies} />
        </Alert>
      )}

      {data.ready && !selectedBuild && !loadFailed && (
        onboard?.buildError ? (
          <Alert variant="warning" role="alert" className="onboard-banner">
            <p>
              Assembly {assembly.summary} ({assembly.key}) was created, but Build 1 couldn&apos;t be
              created: {onboard.buildError}. Your Assembly is saved.
            </p>
            <div className="btn-group">
              <Button
                variant="primary"
                onClick={() => create({ name: assembly.name }, 'empty')}
                disabled={!!createBusy}
                aria-describedby={emptyError ? 'empty-build-error' : undefined}
              >
                {createBusy === 'empty' ? 'Creating…' : 'Try again: Create Build 1'}
              </Button>
            </div>
            {emptyError && <p id="empty-build-error" className="form-error" role="alert">{emptyError}</p>}
          </Alert>
        ) : (
          <EmptyState
            title="No Builds yet"
            action={(
              <Button
                variant="primary"
                onClick={() => create({ name: assembly.name }, 'empty')}
                disabled={!!createBusy}
                aria-describedby={emptyError ? 'empty-build-error' : 'empty-build-name'}
              >
                {createBusy === 'empty' ? 'Creating…' : 'Create Build 1'}
              </Button>
            )}
          >
            <p>A Build is one combination of Parts for this Assembly. Parts are saved into a Build, so start with Build 1.</p>
            <p id="empty-build-name" className="text-sm">
              Name: {assembly.name} Build {nextNumber} · starts as Draft (not ready to build yet)
            </p>
            {emptyError && <p id="empty-build-error" className="form-error" role="alert">{emptyError}</p>}
          </EmptyState>
        )
      )}

      <section className="build-panel" aria-labelledby="build-panel-title">
        <div className="build-panel-header">
          <h2 id="build-panel-title" className="build-panel-title">
            {selectedBuild ? (
              <>{buildName} <span aria-hidden="true">·</span> <Badge status={selectedBuild.status} /></>
            ) : 'Parts'}
          </h2>
          <div className="build-panel-actions">
            {!viewOnly && (
              <Button
                variant="secondary"
                onClick={() => runCad({ fresh: true })}
                ariaDisabled={!!cadDisabledReason}
                disabled={cadBusy || saving}
                aria-describedby={cadDisabledReason ? 'cad-help' : undefined}
              >
                <span aria-hidden="true">⟳ </span>{cadBusy ? 'Reading CAD…' : 'Update from CAD'}
              </Button>
            )}
            {selectedBuild && !viewOnly && (
              <Button
                variant="secondary"
                onClick={openCut}
                ariaDisabled={!!cutDisabledReason}
                disabled={cutBusy}
                title={cutDisabledReason ?? undefined}
              >
                <span aria-hidden="true">✂ </span>Cut Version
              </Button>
            )}
          </div>
        </div>
        {cadDisabledReason && !viewOnly && <p id="cad-help" className="form-help build-panel-help">{cadDisabledReason}</p>}
        {cadError && !viewOnly && <Alert variant="error" role="alert">{cadError}</Alert>}

        {viewOnly && (
          <Alert
            variant="info"
            role="status"
            actions={(
              <Button
                variant="primary"
                onClick={() => { setNewError(null); setNewStart('copy'); setNewOpen(true); }}
                disabled={!!createBusy}
              >
                New Build from this one
              </Button>
            )}
          >
            {buildName} is cut. Make a new Build to change Parts.
          </Alert>
        )}

        {actionMsg && (
          <Alert variant={actionMsg.variant} role={actionMsg.variant === 'error' ? 'alert' : 'status'}>
            {actionMsg.text}
          </Alert>
        )}

        {buildWarning && <Alert variant="warning" role="alert">{buildWarning}</Alert>}

        <TwoActiveWarning
          builds={builds}
          cutFailedKey={cutFailedKey}
          documentId={assembly.documentId}
          assemblyKey={key}
          onStatus={addStatus}
          onResolved={() => { setCutFailedKey(null); data.refresh(); }}
        />

        {!viewOnly && preview?.subAssemblies?.length > 0 && (
          <Alert variant="info" role="status" className="sub-assembly-note">
            {preview.subAssemblies.length === 1 ? '1 sub-assembly is' : `${preview.subAssemblies.length} sub-assemblies are`} an
            Assembly, not Parts: {preview.subAssemblies.map((s) => s.name || s.partNumber).join(', ')}.
            Paste this assembly&apos;s OnShape link on Home to add any that are missing.
          </Alert>
        )}
        {!viewOnly && preview?.unidentified?.length > 0 && <UnidentifiedPartsWarning parts={preview.unidentified} />}

        {!selectedBuild && hasAnyParts && data.ready && (
          <p className="form-help">Create Build 1 to add these Parts to it.</p>
        )}

        {data.ready ? (
          <DesignerPartsTable
            groups={groups}
            buildName={buildName}
            selection={work.selection}
            onToggle={onToggle}
            onToggleAll={onToggleAll}
            onEdit={onEdit}
            onRetry={onRetry}
            heldBack={heldBack}
            locked={locked}
            busy={saving}
            viewOnly={viewOnly}
            onRecreate={recreate}
            recreatingKey={recreatingKey}
            recreateBlocked={recreateBlocked}
            actionsLocked={!!recreatingKey}
          />
        ) : (
          <p className="page-loading" role="status">Loading Builds and Parts…</p>
        )}
      </section>

      {(hasPending || saving || saveError) && (
        <StickySaveBar
          summary={`Unsaved: ${plural(counts.creates, 'new Part', 'new Parts')} · ${plural(counts.updates, 'change', 'changes')} · ${counts.added} added to ${buildName ?? 'Build'}`}
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

      <CutVersionDialog
        open={cutOpen}
        build={selectedBuild}
        toSupersede={toSupersede}
        busy={cutBusy}
        error={cutError}
        alreadyCut={cutAlreadyCut}
        onConfirm={confirmCut}
        onClose={() => setCutOpen(false)}
      />

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
