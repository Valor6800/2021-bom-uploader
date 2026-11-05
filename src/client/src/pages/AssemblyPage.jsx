import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link, useLocation, useNavigate, useParams, useSearchParams,
} from 'react-router-dom';
import { archiveBuild, clonePart } from '../api/client.js';
import { useAssemblyData } from '../components/assembly-shared/useAssemblyData.js';
import AssemblyHeader from '../components/assembly-shared/AssemblyHeader.jsx';
import AssemblyLoadError from '../components/assembly-shared/AssemblyLoadError.jsx';
import TwoActiveWarning from '../components/builds/TwoActiveWarning.jsx';
import BuildTabs, { TABPANEL_ID, tabId } from '../components/assembly/BuildTabs.jsx';
import AssemblyPartRow, { COLUMN_COUNT } from '../components/assembly/AssemblyPartRow.jsx';
import BuildCompare from '../components/assembly/BuildCompare.jsx';
import PrintView from '../components/assembly/PrintView.jsx';
import PurchasedParts from '../components/assembly/PurchasedParts.jsx';
import BuildGuide from '../components/assembly/BuildGuide.jsx';
import KitSheet from '../components/assembly/KitSheet.jsx';
import BuildReadiness from '../components/assembly/BuildReadiness.jsx';
import { useGuide } from '../components/assembly-shared/useGuideData.js';
import BuildImage from '../components/assembly-shared/BuildImage.jsx';
import CloneDialog from '../components/assembly/CloneDialog.jsx';
import SubAssemblyLinks from '../components/assembly-shared/SubAssemblyLinks.jsx';
import Alert from '../components/ui/Alert.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import DisclosureMenu from '../components/ui/DisclosureMenu.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { friendlyClause } from '../lib/friendlyError.js';
import {
  buildLabel, defaultAssembleBuildKey, dropAgreedStatus, overlayBuildStatus, visibleBuilds,
} from '../lib/buildNames.js';
import {
  deriveDesignerRows, dropAgreedParts, mergeLinks, mergeParts,
} from '../lib/designerRows.js';

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
 * needs for one Assembly. One tab per cut Build, the Build's Parts as
 * plain text (a cut Build never changes; the Designer makes a new Build),
 * Parts in no Build, Create spare, Archive, Compare and Print. No Cut Version
 * here: that is a CAD decision (Q3).
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
  const [createdParts, setCreatedParts] = useState(() => new Map());
  const [actionMsg, setActionMsg] = useState(null); // { variant, text }
  const [showArchived, setShowArchived] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState(null);
  const [wrongBuild, setWrongBuild] = useState(false);
  const [compareKeys, setCompareKeys] = useState(null); // [a, b]
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
  // Print, the two-Active check, current-Build labels) sees only the
  // Builds that are ready.
  const builds = useMemo(() => allBuilds.filter((b) => b.status !== 'Draft'), [allBuilds]);
  const requested = searchParams.get('build');
  const view = searchParams.get('view');
  const selectedKey = defaultAssembleBuildKey(builds, requested);
  const selectedBuild = builds.find((b) => b.key === selectedKey) ?? null;
  const buildName = selectedBuild ? buildLabel(selectedBuild) : null;
  const archivedCount = builds.filter((b) => b.status === 'Archived').length;
  const tabBuilds = builds.filter((b) => b.status !== 'Archived' || showArchived || b.key === selectedKey);
  const loadFailed = !!data.secondaryError;

  // Overlays end once a re-fetch agrees.
  useEffect(() => {
    setStatusThisSession((prev) => dropAgreedStatus(prev, data.fetchedBuilds));
  }, [data.fetchedBuilds]);
  useEffect(() => {
    setCreatedParts((prev) => dropAgreedParts(prev, data.parts));
  }, [data.parts]);

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
  const links = useMemo(() => mergeLinks(data.linkedByPart), [data.linkedByPart]);
  const { groups } = useMemo(() => deriveDesignerRows({
    parts: data.parts,
    createdParts,
    chainKeys: data.chain,
    linkedByPart: data.linkedByPart,
    buildKey: selectedKey,
    builds,
  }), [data.parts, createdParts, data.chain, data.linkedByPart, selectedKey, builds]);

  // ----- Manufacturing status and the guide -----
  const partsByKey = useMemo(() => new Map(allParts.map((p) => [p.key, p])), [allParts]);
  // A plate's or axle's drawing is on the ticket its picture comes from, once its Build was cut.
  const drawingKeyOf = useCallback((row) => {
    const files = partsByKey.get(row.imageKey)?.files;
    const prefix = `${row.fullPartNumber}_drawing`;
    return files?.some((f) => f.startsWith(prefix) && f.endsWith('.png')) ? row.imageKey : null;
  }, [partsByKey]);
  // The drawings column shows only when some Part in the table has one.
  const showDrawings = useMemo(
    () => [...groups.inBuild, ...groups.other].some((row) => drawingKeyOf(row)),
    [groups, drawingKeyOf],
  );
  /** The selected Build's Parts with their tracker status, for readiness and the guide. */
  const buildParts = useMemo(() => groups.inBuild
    .map((r) => {
      const part = partsByKey.get(r.key);
      return part ? { ...part, imageKey: r.imageKey } : null;
    })
    .filter(Boolean), [groups.inBuild, partsByKey]);
  /** 4-digit Part number -> the Build's Part (the guide's rows carry OnShape's number). */
  const partsByNumber = useMemo(() => {
    const map = new Map();
    for (const p of buildParts) if (p.partNumber && !map.has(p.partNumber)) map.set(p.partNumber, p);
    return map;
  }, [buildParts]);
  const guideState = useGuide((view === 'guide' || view === 'kit') && data.ready ? selectedKey : null);

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
    if (buildKey !== selectedKey) selectBuild(buildKey);
  };

  const viewUrl = (v) => {
    const next = new URLSearchParams();
    if (selectedKey) next.set('build', selectedKey);
    if (v) next.set('view', v);
    return `?${next}`;
  };

  // ----- Clone -----
  const cloneSources = useMemo(() => {
    const chain = new Set(data.chain);
    return allParts
      .filter((p) => chain.has(p.epic))
      .sort((a, b) => (a.fullPartNumber ?? a.summary).localeCompare(b.fullPartNumber ?? b.summary));
  }, [allParts, data.chain]);

  const clone = async ({ sourceKey, quantity }) => {
    setCloneBusy(true);
    setCloneError(null);
    try {
      const res = await clonePart(sourceKey, { epicKey: key, quantity });
      setCreatedParts((prev) => withPart(prev, res.part));
      const number = res.part?.fullPartNumber ?? res.fullPartNumber;
      setActionMsg({ variant: 'info', text: `Created spare ${res.key} (${number}).` });
      setCloneOpen(false);
      data.refresh();
    } catch (err) {
      setCloneError(`Couldn't create the spare: ${friendlyClause(err)}`);
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
  } else if (view === 'guide' && selectedBuild) {
    body = (
      <BuildGuide
        build={selectedBuild}
        buildName={buildName}
        guideState={guideState}
        partsByNumber={partsByNumber}
        buildParts={buildParts}
        backTo={viewUrl(null)}
        kitTo={viewUrl('kit')}
      />
    );
  } else if (view === 'kit' && selectedBuild) {
    body = (
      <KitSheet assembly={assembly} build={selectedBuild} guideState={guideState} backTo={viewUrl(null)} guideTo={viewUrl('guide')} />
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
                    OnShape link <span aria-hidden="true">↗</span>
                  </a>
                )}
                <Link to={viewUrl('guide')} className="btn btn-primary">
                  <span aria-hidden="true">🔧 </span>Build guide
                </Link>
                <Link to={viewUrl('kit')} className="btn btn-secondary">
                  <span aria-hidden="true">🧰 </span>Kit sheet
                </Link>
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
                  Create spare
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

            <BuildImage buildKey={selectedBuild.key} label={buildName} />

            <BuildReadiness parts={buildParts} buildName={buildName} />

            <div className="parts-table-wrap">
              <table className="table parts-table assembly-table">
                <caption className="visually-hidden">Parts for {buildName}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="cell-part">Part</th>
                    <th scope="col">Status</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Material</th>
                    <th scope="col">Machinery</th>
                    <th scope="col">Powdercoat</th>
                    <th scope="col">Tapping</th>
                    <th scope="col">Thickness</th>
                    <th scope="col">Priority</th>
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
                        No Parts in {buildName}.
                      </td>
                    </tr>
                  )}
                  {groups.inBuild.map((row) => (
                    <AssemblyPartRow
                      key={row.rowId}
                      row={row}
                      inBuild
                      tracker={partsByKey.get(row.key)}
                      drawingKey={showDrawings ? drawingKeyOf(row) : undefined}
                    />
                  ))}
                </tbody>
                {groups.other.length > 0 && (
                  <tbody className="parts-group parts-group-other">
                    <tr className="group-row">
                      <th scope="colgroup" colSpan={COLUMN_COUNT}>
                        <span className="group-title">Not in any Build</span>
                        <span className="group-count">{groups.other.length}</span>
                      </th>
                    </tr>
                    {groups.other.map((row) => (
                      <AssemblyPartRow
                        key={row.rowId}
                        row={row}
                        inBuild={false}
                        drawingKey={showDrawings ? drawingKeyOf(row) : undefined}
                      />
                    ))}
                  </tbody>
                )}
                <PurchasedParts assemblyKey={key} buildKey={selectedKey} />
              </table>
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <div className={`work-page assembly-page${view === 'print' || view === 'kit' ? ' assembly-page-print' : ''}`}>
      <div className={view === 'print' || view === 'kit' ? 'no-print' : undefined}>
        <AssemblyHeader
          assembly={assembly}
          revisions={data.revisions}
          mode="assemble"
          buildKey={selectedKey}
          onRevisionChange={onRevisionChange}
        />
      </div>

      <div className={view === 'print' || view === 'kit' ? 'no-print' : undefined}>
        <SubAssemblyLinks assemblyKey={key} mode="assemble" />
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

    </div>
  );
}
