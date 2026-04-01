import { useState, useCallback } from 'react';
import {
  MACHINERY, POWDERCOAT, THICKNESS,
  previewParts, createStory, updateStory,
} from '../api/client.js';
import Card from './ui/Card.jsx';
import Button from './ui/Button.jsx';
import Badge from './ui/Badge.jsx';

export default function PartsListTable({
  stories,
  selectedEpic,
  jiraBaseUrl,
  onStoriesUpdated,
  onSaveComplete,
  loading,
  setLoading,
}) {
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [duplicates, setDuplicates] = useState([]);

  const newParts = stories.filter((s) => s._status === 'New');
  const hasChanges = stories.some(
    (s) => s._status === 'Changes' || s._status === 'New',
  );
  const selectedNewCount = newParts.filter((s) => selected.has(s.fullPartNumber)).length;

  const toggleSelect = useCallback((partNumber) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(partNumber)) next.delete(partNumber);
      else next.add(partNumber);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === newParts.length) return new Set();
      return new Set(newParts.map((s) => s.fullPartNumber));
    });
  }, [newParts]);

  const handleFieldChange = useCallback((idx, field, value) => {
    onStoriesUpdated((prev) => {
      const updated = [...prev];
      const story = updated[idx];
      const newStatus = story._status === 'Exists' ? 'Changes' : story._status;
      updated[idx] = { ...story, [field]: value, _status: newStatus };
      return updated;
    });
  }, [onStoriesUpdated]);

  const handleUpdateFromCAD = useCallback(async () => {
    if (!selectedEpic) return;
    setLoading(true);
    setDuplicates([]);
    try {
      const epic = selectedEpic;
      const preview = await previewParts({
        epicKey: epic.key,
        documentId: epic.documentId || epic.d,
        workspaceId: epic.workspaceId || epic.w,
        elementId: epic.elementId || epic.e,
      });

      // Merge preview into the stories list
      const merged = [];

      // Existing parts with changes
      for (const entry of (preview.existingParts || [])) {
        const status = entry.changes?.count > 0 ? 'Changes' : 'Exists';
        merged.push({ ...entry.story, ...entry.bomItem, key: entry.story.key, _status: status });
      }

      // New parts
      const newItems = (preview.newParts || []).map((item) => ({
        ...item,
        key: 'N/A',
        summary: `${item.fullPartNumber} ${item.name}`,
        _status: 'New',
      }));
      merged.push(...newItems);

      // Auto-select all new parts
      setSelected(new Set(newItems.map((s) => s.fullPartNumber)));

      // Track duplicates for warning display
      setDuplicates(preview.duplicates || []);

      onStoriesUpdated(merged);
    } catch (err) {
      console.error('Update from CAD failed:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedEpic, onStoriesUpdated, setLoading]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updatedStories = [...stories];
      for (let i = 0; i < updatedStories.length; i++) {
        const story = updatedStories[i];

        // Create new parts that are selected
        if (story._status === 'New' && selected.has(story.fullPartNumber)) {
          try {
            const result = await createStory({
              epic: story.epic,
              quantity: parseInt(story.quantity, 10),
              summary: story.summary,
              material: story.material,
              machinery: story.machinery,
              powdercoat: story.powdercoat,
              thickness: story.thickness,
            });
            updatedStories[i] = {
              ...story,
              key: result.key,
              fullPartNumber: result.fullPartNumber || story.fullPartNumber,
              _status: 'Updated',
            };
          } catch (err) {
            console.error('Failed to create:', story.fullPartNumber, err);
          }
        }

        // Update existing parts with changes
        if (story._status === 'Changes' && story.key && story.key !== 'N/A') {
          try {
            await updateStory(story.key, {
              quantity: parseInt(story.quantity, 10),
              summary: story.summary,
              material: story.material,
              machinery: story.machinery,
              powdercoat: story.powdercoat,
              thickness: story.thickness,
            });
            updatedStories[i] = { ...story, _status: 'Updated' };
          } catch (err) {
            console.error('Failed to update:', story.key, err);
          }
        }
      }
      onStoriesUpdated(updatedStories);
      setSelected(new Set());
      if (onSaveComplete) onSaveComplete();
    } finally {
      setSaving(false);
    }
  }, [stories, selected, onStoriesUpdated, onSaveComplete]);

  const isPowdercoatEnabled = (material) =>
    material && material.includes('AL 6061');

  const isThicknessEnabled = (material) =>
    material && (material.includes('AL 6061') || material.includes('Polycarb') || material.includes('Wood') || material.includes('SRPP'));

  const allNewSelected = newParts.length > 0 && selectedNewCount === newParts.length;

  const headerButtons = (
    <div className="btn-group">
      <Button
        variant="primary"
        onClick={handleUpdateFromCAD}
        disabled={!selectedEpic || loading}
      >
        ↻ {loading ? 'Loading...' : 'Update from CAD'}
      </Button>
      <Button
        variant="success"
        onClick={handleSave}
        disabled={!hasChanges || saving}
      >
        💾 {saving ? 'Saving...' : 'Save Changes'}
        {selectedNewCount > 0 && ` (${selectedNewCount} new)`}
      </Button>
    </div>
  );

  return (
    <Card title="Jira Part List" icon="☰" headerRight={headerButtons}>

      {/* Duplicate warnings */}
      {duplicates.length > 0 && (
        <div className="duplicates-box" style={{ margin: '1rem' }}>
          <h3 className="text-red font-semibold mb-2">
            🚫 Duplicate Part Numbers Detected
          </h3>
          <p className="text-red text-sm mb-2">
            Resolve these in Onshape before uploading. Duplicates are excluded from save.
          </p>
          {duplicates.map((dup) => (
            <div key={dup.partNumber} className="duplicate-item">
              <span className="text-orange font-mono font-semibold">{dup.partNumber}</span>
              <span className="text-red text-sm ml-2">— {dup.occurrences.length} occurrences</span>
            </div>
          ))}
        </div>
      )}

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '2.5rem' }}>
                {newParts.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allNewSelected}
                    onChange={toggleSelectAll}
                    className="preview-checkbox"
                    title="Select/deselect all new parts"
                  />
                )}
              </th>
              {['Key', 'Qty', 'Summary', 'Material', 'Machinery', 'Powdercoat', 'Thickness', 'Status'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stories.length === 0 && (
              <tr>
                <td colSpan={9} className="table-empty">
                  {selectedEpic ? 'No parts found. Click "Update from CAD" to load BOM.' : 'Select an assembly to view parts.'}
                </td>
              </tr>
            )}
            {stories.map((story, idx) => {
              const isNew = story._status === 'New';
              const isChecked = isNew && selected.has(story.fullPartNumber);
              return (
                <tr key={story.fullPartNumber || idx} className={isNew && !isChecked ? 'row-deselected' : ''}>
                  <td>
                    {isNew && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(story.fullPartNumber)}
                        className="preview-checkbox"
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap font-medium">
                    {story.key && story.key !== 'N/A' ? (
                      <a
                        href={`${jiraBaseUrl}/browse/${story.key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-gold"
                      >
                        {story.key}
                      </a>
                    ) : (
                      <span className="text-dim">New</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <input
                      type="number"
                      value={story.quantity || ''}
                      onChange={(e) => handleFieldChange(idx, 'quantity', e.target.value)}
                      className="input-inline input-number"
                    />
                  </td>
                  <td className="text-light">
                    {story.summary}
                    {isNew && story.machinery === '3D Printer' && (
                      <span className="step-indicator">STEP auto-export</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-muted">{story.material}</td>
                  <td className="whitespace-nowrap">
                    <select
                      value={story.machinery || 'None'}
                      onChange={(e) => handleFieldChange(idx, 'machinery', e.target.value)}
                      className="select-inline"
                    >
                      {MACHINERY.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="whitespace-nowrap">
                    <select
                      value={story.powdercoat || 'None'}
                      onChange={(e) => handleFieldChange(idx, 'powdercoat', e.target.value)}
                      disabled={!isPowdercoatEnabled(story.material)}
                      className="select-inline"
                    >
                      {POWDERCOAT.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="whitespace-nowrap">
                    <select
                      value={story.thickness || 'None'}
                      onChange={(e) => handleFieldChange(idx, 'thickness', e.target.value)}
                      disabled={!isThicknessEnabled(story.material)}
                      className="select-inline"
                    >
                      {THICKNESS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="whitespace-nowrap">
                    <Badge status={story._status || 'Exists'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
