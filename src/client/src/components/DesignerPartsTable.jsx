import { useState, useEffect, useCallback } from 'react';
import {
  previewParts, createStory, updateStory, linkPartToBuild, cutBuildVersion,
} from '../api/client.js';
import { useAppStore } from '../store/index.js';
import Card from './ui/Card.jsx';
import Button from './ui/Button.jsx';
import Alert from './ui/Alert.jsx';
import DuplicateWarning from './parts/DuplicateWarning.jsx';
import UnidentifiedPartsWarning from './parts/UnidentifiedPartsWarning.jsx';
import PartsTableToolbar from './parts/PartsTableToolbar.jsx';
import PartRow from './parts/PartRow.jsx';

const COLUMNS = ['Key', 'Qty', 'Summary', 'Material', 'Machinery', 'Powdercoat', 'Thickness', 'Status'];

/** The real key to save/link by: the Jira key once it exists, else the draft part number. */
function selectionKey(row) {
  return row.key && row.key !== 'N/A' ? row.key : row.fullPartNumber;
}

/**
 * Build-scoped parts table for the Designer tab. Separate from
 * PartsListTable (the Assembly BOM page's table) because the status model
 * here has an extra axis: a part can exist under the Assembly but not be
 * linked ("Used In") to *this* Build yet — reused from a sibling Build.
 *
 * Reuses the smaller presentational pieces (PartRow, PartsTableToolbar,
 * DuplicateWarning, partRules.js via PartRow) rather than PartsListTable
 * itself, since the Assembly BOM page still depends on that one as-is.
 */
export default function DesignerPartsTable({ jiraBaseUrl }) {
  const selectedEpic = useAppStore((s) => s.selectedEpic);
  const selectedBuild = useAppStore((s) => s.selectedBuild);
  const buildParts = useAppStore((s) => s.buildParts);
  const reloadBuildParts = useAppStore((s) => s.reloadBuildParts);
  const markBuildCreated = useAppStore((s) => s.markBuildCreated);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [duplicates, setDuplicates] = useState([]);
  const [unidentified, setUnidentified] = useState([]);
  const [cutting, setCutting] = useState(false);
  const [cutMsg, setCutMsg] = useState(null); // { type: 'success'|'error', text }

  // Switching Builds clears in-progress selection and re-derives which rows
  // already belong to it, without forcing a full CAD refetch.
  useEffect(() => {
    setSelected(new Set());
  }, [selectedBuild?.key]);

  useEffect(() => {
    setRows((prev) => prev.map((r) => (
      r._status === 'New' ? r : { ...r, _inBuild: buildParts.includes(r.key) }
    )));
  }, [buildParts]);

  const newRows = rows.filter((r) => r._status === 'New');
  const hasChanges = rows.some((r) => r._status === 'Changes' || r._status === 'New') || selected.size > 0;
  const selectedNewCount = newRows.filter((r) => selected.has(selectionKey(r))).length;
  const allNewSelected = newRows.length > 0 && selectedNewCount === newRows.length;

  const toggleSelect = useCallback((key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAllNew = useCallback(() => {
    setSelected((prev) => {
      const newKeys = newRows.map(selectionKey);
      const allSelected = newKeys.length > 0 && newKeys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (allSelected) newKeys.forEach((k) => next.delete(k));
      else newKeys.forEach((k) => next.add(k));
      return next;
    });
  }, [newRows]);

  const handleFieldChange = useCallback((idx, field, value) => {
    setRows((prev) => {
      const updated = [...prev];
      const row = updated[idx];
      const newStatus = row._status === 'Exists' ? 'Changes' : row._status;
      updated[idx] = { ...row, [field]: value, _status: newStatus };
      return updated;
    });
  }, []);

  const handleUpdateFromCAD = useCallback(async () => {
    if (!selectedEpic || !selectedBuild) return;
    setLoading(true);
    setDuplicates([]);
    setUnidentified([]);
    try {
      const preview = await previewParts({
        epicKey: selectedEpic.key,
        documentId: selectedEpic.documentId,
        workspaceId: selectedEpic.workspaceId,
        elementId: selectedEpic.elementId,
      });
      await reloadBuildParts();
      const inBuildSet = new Set(useAppStore.getState().buildParts);

      const merged = [];
      for (const entry of (preview.existingParts || [])) {
        const { count, ...changedFields } = entry.changes ?? {};
        const status = count > 0 ? 'Changes' : 'Exists';
        merged.push({
          ...entry.story,
          ...changedFields,
          _status: status,
          _inBuild: inBuildSet.has(entry.story.key),
        });
      }

      const newItems = (preview.newParts || []).map((item) => ({
        ...item,
        key: 'N/A',
        summary: `${item.fullPartNumber} ${item.name}`,
        _status: 'New',
        _inBuild: false,
      }));
      merged.push(...newItems);

      setSelected(new Set(newItems.map(selectionKey)));
      setDuplicates(preview.duplicates || []);
      setUnidentified(preview.unidentified || []);
      setRows(merged);
    } catch (err) {
      console.error('Update from CAD failed:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedEpic, selectedBuild, reloadBuildParts]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = [...rows];
      for (let i = 0; i < updated.length; i++) {
        const row = updated[i];
        const isSelected = selected.has(selectionKey(row));

        if (row._status === 'New' && isSelected) {
          try {
            const result = await createStory({
              epic: row.epic,
              quantity: parseInt(row.quantity, 10),
              summary: row.summary,
              material: row.material,
              machinery: row.machinery,
              powdercoat: row.powdercoat,
              thickness: row.thickness,
            });
            await linkPartToBuild(selectedBuild.key, result.key);
            updated[i] = {
              ...row,
              key: result.key,
              fullPartNumber: result.fullPartNumber || row.fullPartNumber,
              _status: 'Updated',
              _inBuild: true,
            };
          } catch (err) {
            console.error('Failed to create:', row.fullPartNumber, err);
          }
          continue;
        }

        if (row._status === 'Changes' && row.key && row.key !== 'N/A') {
          try {
            await updateStory(row.key, {
              quantity: parseInt(row.quantity, 10),
              summary: row.summary,
              material: row.material,
              machinery: row.machinery,
              powdercoat: row.powdercoat,
              thickness: row.thickness,
            });
            let inBuild = row._inBuild;
            if (!inBuild && isSelected) {
              await linkPartToBuild(selectedBuild.key, row.key);
              inBuild = true;
            }
            updated[i] = { ...row, _status: 'Updated', _inBuild: inBuild };
          } catch (err) {
            console.error('Failed to update:', row.key, err);
          }
          continue;
        }

        if (row._status === 'Exists' && !row._inBuild && isSelected) {
          try {
            await linkPartToBuild(selectedBuild.key, row.key);
            updated[i] = { ...row, _status: 'Updated', _inBuild: true };
          } catch (err) {
            console.error('Failed to link existing part to build:', row.key, err);
          }
        }
      }
      setRows(updated);
      setSelected(new Set());
      await reloadBuildParts();
    } finally {
      setSaving(false);
    }
  }, [rows, selected, selectedBuild, reloadBuildParts]);

  const handleCutVersion = useCallback(async () => {
    if (!selectedBuild || !selectedEpic) return;
    setCutting(true);
    setCutMsg(null);
    try {
      const result = await cutBuildVersion(selectedBuild.key, {
        assemblyKey: selectedEpic.key,
        documentId: selectedEpic.documentId,
        workspaceId: selectedEpic.workspaceId,
        elementId: selectedEpic.elementId,
      });
      const supersededNote = result.superseded?.length
        ? ` (superseded ${result.superseded.join(', ')})`
        : '';
      setCutMsg({ type: 'success', text: `Version cut — ${selectedBuild.key} is now Active${supersededNote}.` });
      markBuildCreated();
    } catch (err) {
      setCutMsg({ type: 'error', text: err.message || 'Failed to cut version' });
    } finally {
      setCutting(false);
    }
  }, [selectedBuild, selectedEpic, markBuildCreated]);

  if (!selectedEpic || !selectedBuild) {
    return (
      <Card title="Designer Parts" icon="☰">
        <div className="card-body">
          <p className="text-dim">Select an Assembly and a Build above to load parts.</p>
        </div>
      </Card>
    );
  }

  const toolbar = (
    <div className="btn-group">
      <PartsTableToolbar
        onUpdateFromCAD={handleUpdateFromCAD}
        onSave={handleSave}
        canUpdate={Boolean(selectedEpic && selectedBuild)}
        loading={loading}
        hasChanges={hasChanges}
        saving={saving}
        selectedNewCount={selectedNewCount}
      />
      <Button variant="secondary" onClick={handleCutVersion} disabled={cutting}>
        ✂ {cutting ? 'Cutting...' : 'Cut Version'}
      </Button>
    </div>
  );

  return (
    <Card title={`Designer Parts — ${selectedBuild.summary}`} icon="☰" headerRight={toolbar}>
      {cutMsg && (
        <div style={{ margin: '1rem' }}>
          <Alert variant={cutMsg.type === 'success' ? 'info' : 'error'}>{cutMsg.text}</Alert>
        </div>
      )}
      <DuplicateWarning duplicates={duplicates} />
      <UnidentifiedPartsWarning parts={unidentified} />

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '2.5rem' }}>
                {newRows.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allNewSelected}
                    onChange={toggleSelectAllNew}
                    className="preview-checkbox"
                    title="Select/deselect all new parts"
                  />
                )}
              </th>
              {COLUMNS.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="table-empty">
                  {unidentified.length > 0
                    ? 'No parts could be identified from the BOM. See the rows listed above.'
                    : 'No parts found. Click "Update from CAD" to load the BOM.'}
                </td>
              </tr>
            )}
            {rows.map((row, idx) => {
              const canSelect = row._status === 'New' || !row._inBuild;
              const isSelected = canSelect && selected.has(selectionKey(row));
              const membershipLabel = row._status !== 'New' && !row._inBuild
                ? 'from another build'
                : null;
              return (
                <PartRow
                  key={row.fullPartNumber || idx}
                  story={row}
                  jiraBaseUrl={jiraBaseUrl}
                  isSelected={isSelected}
                  selectable={canSelect}
                  membershipLabel={membershipLabel}
                  onToggleSelect={() => toggleSelect(selectionKey(row))}
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
