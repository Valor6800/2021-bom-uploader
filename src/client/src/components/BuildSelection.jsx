import { useState, useEffect, useCallback } from 'react';
import { createBuild } from '../api/client.js';
import { useAppStore } from '../store/index.js';
import Card from './ui/Card.jsx';
import Select from './ui/Select.jsx';
import Button from './ui/Button.jsx';
import Alert from './ui/Alert.jsx';

/**
 * Build picker, scoped to the selected Assembly — mirrors AssemblySelection's
 * dropdown-plus-create-box pattern. A new Build can optionally clone its part
 * list from an existing sibling Build instead of starting empty.
 */
export default function BuildSelection() {
  const selectedEpic = useAppStore((s) => s.selectedEpic);
  const builds = useAppStore((s) => s.builds);
  const buildsLoading = useAppStore((s) => s.buildsLoading);
  const buildReloadKey = useAppStore((s) => s.buildReloadKey);
  const loadBuildsForAssembly = useAppStore((s) => s.loadBuildsForAssembly);
  const selectedBuild = useAppStore((s) => s.selectedBuild);
  const selectBuild = useAppStore((s) => s.selectBuild);
  const markBuildCreated = useAppStore((s) => s.markBuildCreated);

  const [nameValue, setNameValue] = useState('');
  const [cloneFromBuildKey, setCloneFromBuildKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }

  useEffect(() => {
    if (!selectedEpic?.key) {
      selectBuild(null);
      return;
    }
    loadBuildsForAssembly(selectedEpic.key);
  }, [selectedEpic, buildReloadKey, loadBuildsForAssembly, selectBuild]);

  const handleBuildChange = (e) => {
    const val = e.target.value;
    if (val === '0') {
      selectBuild(null);
      return;
    }
    try {
      selectBuild(JSON.parse(val));
    } catch {
      selectBuild(null);
    }
  };

  const handleCreate = useCallback(async () => {
    if (!selectedEpic?.key || !nameValue.trim()) return;
    setCreating(true);
    setMsg(null);
    try {
      const result = await createBuild({
        assemblyKey: selectedEpic.key,
        name: nameValue.trim(),
        cloneFromBuildKey: cloneFromBuildKey || undefined,
      });
      setMsg({ type: 'success', text: `Build ${result.key} created` });
      setNameValue('');
      setCloneFromBuildKey('');
      markBuildCreated();
      setTimeout(() => setMsg((prev) => (prev?.type === 'success' ? null : prev)), 3000);
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Failed to create build' });
    } finally {
      setCreating(false);
    }
  }, [selectedEpic, nameValue, cloneFromBuildKey, markBuildCreated]);

  if (!selectedEpic) {
    return (
      <Card title="Build Selection" icon="🔧" className="mb-8">
        <div className="card-body">
          <p className="text-dim">Select an Assembly above to choose or create a Build.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Build Selection" icon="🔧" collapsible className="mb-8">
      <div className="card-body">
        <div className="grid-3 mb-4">
          <Select
            label="Build"
            id="builds"
            value={selectedBuild ? JSON.stringify(selectedBuild) : '0'}
            onChange={handleBuildChange}
            disabled={buildsLoading}
          >
            <option value="0">
              {buildsLoading ? 'Loading builds...' : 'Select build...'}
            </option>
            {builds.map((build) => (
              <option key={build.key} value={JSON.stringify(build)}>
                {build.summary} ({build.status})
              </option>
            ))}
          </Select>

          <Select
            label="Clone parts from"
            id="cloneFromBuildKey"
            value={cloneFromBuildKey}
            onChange={(e) => setCloneFromBuildKey(e.target.value)}
          >
            <option value="">Start empty</option>
            {builds.map((build) => (
              <option key={build.key} value={build.key}>
                {build.summary} ({build.status})
              </option>
            ))}
          </Select>
        </div>

        <div className="url-input-group">
          <input
            type="text"
            className="url-input"
            placeholder="New build name, e.g. Intake..."
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            disabled={creating}
          />
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!nameValue.trim() || creating}
          >
            {creating ? 'Creating...' : '+ New Build'}
          </Button>
        </div>
        {msg && (
          <Alert variant={msg.type === 'success' ? 'info' : 'error'} className="mt-2">
            {msg.text}
          </Alert>
        )}
      </div>
    </Card>
  );
}
