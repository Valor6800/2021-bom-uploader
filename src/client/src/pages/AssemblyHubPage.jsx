import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchEpicByKey, fetchRevisionChain, fetchBuildsForAssembly, fetchBuildParts,
  fetchPartsByKeys, fetchStoriesByEpic, linkPartToBuild, recreatePartForBuild,
  updateStory, cutBuildVersion, archiveBuild, clonePart,
} from '../api/client.js';
import Card from '../components/ui/Card.jsx';
import Select from '../components/ui/Select.jsx';
import Button from '../components/ui/Button.jsx';
import Alert from '../components/ui/Alert.jsx';
import BuildTabs from '../components/hub/BuildTabs.jsx';
import HubPartRow from '../components/hub/HubPartRow.jsx';
import HubPrintView from '../components/hub/HubPrintView.jsx';
import BuildComparison from '../components/hub/BuildComparison.jsx';

const JIRA_BASE_URL = 'https://jira.valor6800.com';
const COLUMNS = ['Key', 'Qty', 'Summary', 'Material', 'Machinery', 'Powdercoat', 'Thickness', 'Status'];

/** Prefer the Active build; otherwise the highest-numbered one. */
function pickDefaultActiveBuild(builds) {
  const active = builds.find((b) => b.status === 'Active');
  if (active) return active.key;
  const byNumber = [...builds].sort((a, b) => (b.buildNumber ?? 0) - (a.buildNumber ?? 0));
  return byNumber[0]?.key ?? null;
}

/**
 * Assembly hub (Sheet 06) — the one-stop shop for an Assembly: a Build tab
 * per Build under the selected Revision, with a per-build BOM that pulls in
 * parts shared with sibling Builds as explicit Move/Re-create candidates
 * rather than silently merging them.
 */
export default function AssemblyHubPage() {
  const { key } = useParams();

  const [epic, setEpic] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [revisionChain, setRevisionChain] = useState([key]);
  const [revisionEpics, setRevisionEpics] = useState([]);
  const [selectedRevisionKey, setSelectedRevisionKey] = useState(key);

  const [builds, setBuilds] = useState([]);
  const [buildsLoading, setBuildsLoading] = useState(false);
  const [activeBuildKey, setActiveBuildKey] = useState(null);

  const [partsIndex, setPartsIndex] = useState([]); // [{ ...fields, linkedBuildKeys }]
  const [rowsLoading, setRowsLoading] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const [busyPartKey, setBusyPartKey] = useState(null);
  const [actionMsg, setActionMsg] = useState(null); // { type: 'success'|'error', text }
  const [cutting, setCutting] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const [cloneSourceKey, setCloneSourceKey] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneQuantity, setCloneQuantity] = useState('');
  const [cloning, setCloning] = useState(false);

  // Resolve the Assembly itself and its revision chain.
  useEffect(() => {
    setSelectedRevisionKey(key);
    fetchEpicByKey(key).then(setEpic).catch((err) => setLoadError(err.message));
    fetchRevisionChain(key).then(setRevisionChain).catch(() => setRevisionChain([key]));
  }, [key]);

  useEffect(() => {
    if (revisionChain.length <= 1) {
      setRevisionEpics([]);
      return;
    }
    Promise.all(revisionChain.map((k) => fetchEpicByKey(k).catch(() => null)))
      .then((epics) => setRevisionEpics(epics.filter(Boolean)));
  }, [revisionChain]);

  // Build tabs scope to whichever Revision is selected (Sheet 06) — not the
  // whole chain, which is only for continuous Build numbering server-side.
  const reloadBuilds = useCallback(async () => {
    setBuildsLoading(true);
    try {
      const result = await fetchBuildsForAssembly(selectedRevisionKey);
      setBuilds(result);
      setActiveBuildKey((prev) => (result.some((b) => b.key === prev) ? prev : pickDefaultActiveBuild(result)));
    } finally {
      setBuildsLoading(false);
    }
  }, [selectedRevisionKey]);

  useEffect(() => {
    if (!selectedRevisionKey) return;
    reloadBuilds();
  }, [selectedRevisionKey, reloadBuilds]);

  // The per-build BOM: every part linked to any Build under this Revision,
  // each carrying which Builds it's actually in.
  const reloadParts = useCallback(async () => {
    if (!selectedRevisionKey) {
      setPartsIndex([]);
      return;
    }
    setRowsLoading(true);
    try {
      const [perBuild, epicParts] = await Promise.all([
        Promise.all(builds.map((b) => fetchBuildParts(b.key))),
        fetchStoriesByEpic(selectedRevisionKey),
      ]);

      const linksByPart = new Map();
      builds.forEach((build, i) => {
        for (const partKey of perBuild[i]) {
          const existing = linksByPart.get(partKey) ?? [];
          existing.push(build.key);
          linksByPart.set(partKey, existing);
        }
      });

      const byNumberDesc = (a, bKey) => {
        const an = builds.find((b) => b.key === a)?.buildNumber ?? 0;
        const bn = builds.find((b) => b.key === bKey)?.buildNumber ?? 0;
        return bn - an;
      };

      // Every Part under the Assembly, build-linked or not — a just-cloned
      // Part has no Build link yet, and still needs to show up as a
      // Move/Re-create candidate so it's actually findable afterward.
      const buildLinkedKeys = [...linksByPart.keys()];
      const epicPartKeys = (epicParts ?? []).map((p) => p.key);
      const allKeys = [...new Set([...buildLinkedKeys, ...epicPartKeys])];

      const parts = await fetchPartsByKeys(allKeys);
      setPartsIndex(parts.map((part) => ({
        ...part,
        linkedBuildKeys: (linksByPart.get(part.key) ?? []).sort(byNumberDesc),
      })));
      setDirtyKeys(new Set());
    } finally {
      setRowsLoading(false);
    }
  }, [builds, selectedRevisionKey]);

  useEffect(() => {
    reloadParts();
  }, [reloadParts]);

  const rows = useMemo(() => partsIndex.map((part) => {
    const isInActiveBuild = part.linkedBuildKeys.includes(activeBuildKey);
    const currentBuildKey = part.linkedBuildKeys[0] ?? null;
    return {
      ...part,
      isInActiveBuild,
      isCurrent: currentBuildKey === activeBuildKey,
      currentBuildSummary: builds.find((b) => b.key === currentBuildKey)?.summary ?? currentBuildKey,
    };
  }), [partsIndex, activeBuildKey, builds]);

  const activeBuild = builds.find((b) => b.key === activeBuildKey) ?? null;

  const handleFieldChange = useCallback((partKey, field, value) => {
    setPartsIndex((prev) => prev.map((p) => (p.key === partKey ? { ...p, [field]: value } : p)));
    setDirtyKeys((prev) => new Set(prev).add(partKey));
  }, []);

  const handleSaveChanges = useCallback(async () => {
    setSaving(true);
    try {
      for (const partKey of dirtyKeys) {
        const part = partsIndex.find((p) => p.key === partKey);
        if (!part) continue;
        try {
          await updateStory(partKey, {
            summary: part.summary,
            quantity: parseInt(part.quantity, 10),
            material: part.material,
            machinery: part.machinery,
            powdercoat: part.powdercoat,
            thickness: part.thickness,
          });
        } catch (err) {
          console.error('Failed to update:', partKey, err);
        }
      }
      setDirtyKeys(new Set());
    } finally {
      setSaving(false);
    }
  }, [dirtyKeys, partsIndex]);

  const handleMove = useCallback(async (partKey) => {
    if (!activeBuildKey) return;
    setBusyPartKey(partKey);
    setActionMsg(null);
    try {
      await linkPartToBuild(activeBuildKey, partKey);
      await reloadParts();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to move part' });
    } finally {
      setBusyPartKey(null);
    }
  }, [activeBuildKey, reloadParts]);

  const handleRecreate = useCallback(async (partKey) => {
    if (!activeBuildKey) return;
    setBusyPartKey(partKey);
    setActionMsg(null);
    try {
      const result = await recreatePartForBuild(activeBuildKey, partKey);
      setActionMsg({ type: 'success', text: `Re-created as ${result.key} (Revision ${result.revision})` });
      await reloadParts();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to re-create part' });
    } finally {
      setBusyPartKey(null);
    }
  }, [activeBuildKey, reloadParts]);

  const handleCutVersion = useCallback(async () => {
    if (!activeBuild || !epic) return;
    setCutting(true);
    setActionMsg(null);
    try {
      const result = await cutBuildVersion(activeBuild.key, {
        assemblyKey: selectedRevisionKey,
        documentId: epic.documentId,
        workspaceId: epic.workspaceId,
        elementId: epic.elementId,
      });
      const note = result.superseded?.length ? ` (superseded ${result.superseded.join(', ')})` : '';
      setActionMsg({ type: 'success', text: `Version cut — ${activeBuild.key} is now Active${note}.` });
      await reloadBuilds();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to cut version' });
    } finally {
      setCutting(false);
    }
  }, [activeBuild, epic, selectedRevisionKey, reloadBuilds]);

  const handleClonePart = useCallback(async () => {
    if (!cloneSourceKey || !selectedRevisionKey) return;
    setCloning(true);
    setActionMsg(null);
    try {
      const result = await clonePart(cloneSourceKey, {
        epicKey: selectedRevisionKey,
        name: cloneName.trim() || undefined,
        quantity: cloneQuantity ? parseInt(cloneQuantity, 10) : undefined,
      });
      setActionMsg({
        type: 'success',
        text: `Cloned as ${result.key} (${result.fullPartNumber}) — use Move or Re-create to link it to a Build.`,
      });
      setCloneName('');
      setCloneQuantity('');
      await reloadParts();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to clone part' });
    } finally {
      setCloning(false);
    }
  }, [cloneSourceKey, cloneName, cloneQuantity, selectedRevisionKey, reloadParts]);

  const handleArchive = useCallback(async () => {
    if (!activeBuild) return;
    setArchiving(true);
    setActionMsg(null);
    try {
      await archiveBuild(activeBuild.key);
      await reloadBuilds();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to archive build' });
    } finally {
      setArchiving(false);
    }
  }, [activeBuild, reloadBuilds]);

  if (loadError) {
    return <Alert variant="error">{loadError}</Alert>;
  }

  return (
    <>
      <HubPrintView
        assemblySummary={epic?.summary || key}
        build={activeBuild}
        parts={rows.filter((r) => r.isInActiveBuild)}
      />

      <div className="hub-screen-only">

      <Card title={epic?.summary || key} icon="⚙" className="mb-8">
        <div className="card-body">
          {revisionChain.length > 1 && (
            <Select
              label="Revision"
              id="revisionSelect"
              value={selectedRevisionKey}
              onChange={(e) => setSelectedRevisionKey(e.target.value)}
              className="mb-4"
            >
              {revisionEpics.map((rev) => (
                <option key={rev.key} value={rev.key}>{rev.summary}</option>
              ))}
            </Select>
          )}

          <BuildTabs
            builds={builds}
            activeBuildKey={activeBuildKey}
            onSelect={setActiveBuildKey}
          />

          {activeBuild && (
            <div className="btn-group mb-4">
              {activeBuild.onshapeVersionLink && (
                <a
                  href={activeBuild.onshapeVersionLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-gold"
                >
                  View Onshape version
                </a>
              )}
              <Button variant="secondary" onClick={handleCutVersion} disabled={cutting || !epic}>
                ✂ {cutting ? 'Cutting...' : 'Cut Version'}
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                🖨 Print
              </Button>
              <Button variant="danger" onClick={handleArchive} disabled={archiving}>
                {archiving ? 'Archiving...' : 'Archive'}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {actionMsg && (
        <Alert variant={actionMsg.type === 'success' ? 'info' : 'error'} className="mb-4">
          {actionMsg.text}
        </Alert>
      )}

      <BuildComparison builds={builds} parts={partsIndex} />

      <Card title="Clone a part" icon="⧉" collapsible defaultCollapsed className="mb-8">
        <div className="card-body">
          <p className="text-dim mb-2">
            For something the assembly side needs that never touched CAD — a spare, a second
            fastener plate. Copies material/machinery defaults into a fresh, unrelated ticket
            with its own number; it isn't linked to a Build until you Move or Re-create it below.
          </p>
          <div className="grid-3 mb-2">
            <Select
              label="Copy from"
              id="cloneSource"
              value={cloneSourceKey}
              onChange={(e) => setCloneSourceKey(e.target.value)}
            >
              <option value="">Select a part...</option>
              {partsIndex.map((part) => (
                <option key={part.key} value={part.key}>{part.summary}</option>
              ))}
            </Select>
            <input
              type="text"
              className="url-input"
              placeholder="New part's name"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
            />
            <input
              type="number"
              className="input-inline"
              placeholder="Quantity"
              value={cloneQuantity}
              onChange={(e) => setCloneQuantity(e.target.value)}
            />
          </div>
          <Button variant="primary" onClick={handleClonePart} disabled={!cloneSourceKey || cloning}>
            {cloning ? 'Cloning...' : 'Clone Part'}
          </Button>
        </div>
      </Card>

      <Card
        title={activeBuild ? `BOM — ${activeBuild.summary}` : 'BOM'}
        icon="☰"
        headerRight={(
          <Button variant="success" onClick={handleSaveChanges} disabled={dirtyKeys.size === 0 || saving}>
            💾 {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
      >
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                {COLUMNS.map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {!buildsLoading && !rowsLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="table-empty">
                    {activeBuild ? 'No parts yet for this Assembly.' : 'Create a Build to get started.'}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <HubPartRow
                  key={row.key}
                  part={row}
                  jiraBaseUrl={JIRA_BASE_URL}
                  isInActiveBuild={row.isInActiveBuild}
                  isCurrent={row.isCurrent}
                  currentBuildSummary={row.currentBuildSummary}
                  onFieldChange={(field, value) => handleFieldChange(row.key, field, value)}
                  onMove={handleMove}
                  onRecreate={handleRecreate}
                  busy={busyPartKey === row.key}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </div>
    </>
  );
}
