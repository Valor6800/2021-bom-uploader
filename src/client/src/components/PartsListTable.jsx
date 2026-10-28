import { useState, useCallback } from 'react';
import { previewParts, createStory, updateStory } from '../api/client.js';
import { useAppStore } from '../store/index.js';
import Card from './ui/Card.jsx';
import DuplicateWarning from './parts/DuplicateWarning.jsx';
import PartsTableToolbar from './parts/PartsTableToolbar.jsx';
import PartRow from './parts/PartRow.jsx';

const COLUMNS = ['Key', 'Qty', 'Summary', 'Material', 'Machinery', 'Powdercoat', 'Thickness', 'Status'];

export default function PartsListTable({ jiraBaseUrl }) {
  const stories = useAppStore((s) => s.stories);
  const setStories = useAppStore((s) => s.setStories);
  const selectedEpic = useAppStore((s) => s.selectedEpic);
  const loading = useAppStore((s) => s.loading);
  const setLoading = useAppStore((s) => s.setLoading);
  const reloadSelectedEpicStories = useAppStore((s) => s.reloadSelectedEpicStories);

  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [duplicates, setDuplicates] = useState([]);

  const newParts = stories.filter((s) => s._status === 'New');
  const hasChanges = stories.some((s) => s._status === 'Changes' || s._status === 'New');
  const selectedNewCount = newParts.filter((s) => selected.has(s.fullPartNumber)).length;
  const allNewSelected = newParts.length > 0 && selectedNewCount === newParts.length;

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
    setStories((prev) => {
      const updated = [...prev];
      const story = updated[idx];
      const newStatus = story._status === 'Exists' ? 'Changes' : story._status;
      updated[idx] = { ...story, [field]: value, _status: newStatus };
      return updated;
    });
  }, [setStories]);

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

      const merged = [];

      // Existing parts with changes — only overwrite fields that actually
      // changed in CAD so Jira-only values (powdercoat, thickness, etc.) are preserved.
      for (const entry of (preview.existingParts || [])) {
        const { count, ...changedFields } = entry.changes ?? {};
        const status = count > 0 ? 'Changes' : 'Exists';
        merged.push({ ...entry.story, ...changedFields, _status: status });
      }

      // New parts
      const newItems = (preview.newParts || []).map((item) => ({
        ...item,
        key: 'N/A',
        summary: `${item.fullPartNumber} ${item.name}`,
        _status: 'New',
      }));
      merged.push(...newItems);

      setSelected(new Set(newItems.map((s) => s.fullPartNumber)));
      setDuplicates(preview.duplicates || []);
      setStories(merged);
    } catch (err) {
      console.error('Update from CAD failed:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedEpic, setStories, setLoading]);

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
      setStories(updatedStories);
      setSelected(new Set());
      await reloadSelectedEpicStories();
    } finally {
      setSaving(false);
    }
  }, [stories, selected, setStories, reloadSelectedEpicStories]);

  const toolbar = (
    <PartsTableToolbar
      onUpdateFromCAD={handleUpdateFromCAD}
      onSave={handleSave}
      canUpdate={Boolean(selectedEpic)}
      loading={loading}
      hasChanges={hasChanges}
      saving={saving}
      selectedNewCount={selectedNewCount}
    />
  );

  return (
    <Card title="Jira Part List" icon="☰" headerRight={toolbar}>
      <DuplicateWarning duplicates={duplicates} />

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
              {COLUMNS.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {stories.length === 0 && (
              <tr>
                <td colSpan={9} className="table-empty">
                  {selectedEpic
                    ? 'No parts found. Click "Update from CAD" to load BOM.'
                    : 'Select an assembly to view parts.'}
                </td>
              </tr>
            )}
            {stories.map((story, idx) => {
              const isNew = story._status === 'New';
              const isChecked = isNew && selected.has(story.fullPartNumber);
              return (
                <PartRow
                  key={story.fullPartNumber || idx}
                  story={story}
                  jiraBaseUrl={jiraBaseUrl}
                  isSelected={isChecked}
                  onToggleSelect={() => toggleSelect(story.fullPartNumber)}
                  onFieldChange={(field, value) => handleFieldChange(idx, field, value)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
