import Button from '../ui/Button.jsx';

/**
 * Action toolbar for the parts table: refresh from CAD (OnShape) and save
 * changes to Jira.
 */
export default function PartsTableToolbar({
  onUpdateFromCAD,
  onSave,
  canUpdate,
  loading,
  hasChanges,
  saving,
  selectedNewCount,
}) {
  return (
    <div className="btn-group">
      <Button variant="primary" onClick={onUpdateFromCAD} disabled={!canUpdate || loading}>
        ↻ {loading ? 'Loading...' : 'Update from CAD'}
      </Button>
      <Button variant="success" onClick={onSave} disabled={!hasChanges || saving}>
        💾 {saving ? 'Saving...' : 'Save Changes'}
        {selectedNewCount > 0 && ` (${selectedNewCount} new)`}
      </Button>
    </div>
  );
}
