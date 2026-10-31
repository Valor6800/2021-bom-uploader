import DesignerPartRow, { COLUMN_COUNT } from './DesignerPartRow.jsx';

/**
 * The Designer's Parts table, in three groups: New from CAD, In Build N,
 * and Other Parts in this Assembly. Group headings are colgroup header
 * rows. Wide tables scroll sideways with a sticky Part column.
 *
 * @param {object} props
 * @param {{ newFromCad: object[], inBuild: object[], other: object[] }} props.groups
 * @param {string} props.buildName        "Build 1", or null with no Build
 * @param {Set<string>} props.selection
 * @param {(rowId: string, checked: boolean) => void} props.onToggle
 * @param {(rowIds: string[], checked: boolean) => void} props.onToggleAll
 * @param {(rowId: string, field: string, value: any) => void} props.onEdit
 * @param {(rowId: string) => void} props.onRetry
 * @param {Map<string, { field: string, error: string }>} props.heldBack
 * @param {boolean} props.locked           No Build yet, or a load failed: read-only
 * @param {boolean} props.busy
 * @param {boolean} [props.viewOnly]       The Build is cut: only its own Parts, as text
 * @param {(row: object) => void} [props.onRecreate]  Re-create a locked shared Part
 * @param {string|null} [props.recreatingKey]  The Part whose Re-create is running
 * @param {(row: object) => string|null} [props.recreateBlocked]
 * @param {boolean} [props.actionsLocked]
 */
export default function DesignerPartsTable({
  groups, buildName, selection, onToggle, onToggleAll, onEdit, onRetry, heldBack, locked, busy,
  viewOnly = false, onRecreate, recreatingKey = null, recreateBlocked = () => null, actionsLocked = false,
}) {
  const allSections = [
    { id: 'new', title: 'New from CAD', rows: groups.newFromCad, selectAll: true },
    { id: 'in', title: buildName ? `In ${buildName}` : 'In this Build', rows: groups.inBuild },
    {
      id: 'other',
      title: buildName ? 'Other Parts in this Assembly' : 'Parts in this Assembly (not in any Build yet)',
      rows: groups.other,
    },
  ];
  const sections = (viewOnly ? allSections.filter((s) => s.id === 'in') : allSections)
    .filter((s) => s.rows.length > 0 || (s.id === 'in' && buildName));

  const empty = sections.every((s) => s.rows.length === 0);

  return (
    <div className="parts-table-wrap">
      <table className="table parts-table">
        <caption className="visually-hidden">Parts{buildName ? ` for ${buildName}` : ''}</caption>
        <thead>
          <tr>
            <th scope="col" className="cell-check"><span className="visually-hidden">Select</span></th>
            <th scope="col" className="cell-part">Part</th>
            <th scope="col">Qty</th>
            <th scope="col">Material</th>
            <th scope="col">Machinery</th>
            <th scope="col">Powdercoat</th>
            <th scope="col">Thickness</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        {empty && !viewOnly && (
          <tbody>
            <tr>
              <td colSpan={COLUMN_COUNT} className="table-empty">
                No Parts yet. Use Update from CAD to read them from OnShape.
              </td>
            </tr>
          </tbody>
        )}
        {sections.map((section) => {
          const selectable = section.rows.filter((r) => !r.readOnly);
          const allChecked = selectable.length > 0 && selectable.every((r) => selection.has(r.rowId));
          return (
            <tbody key={section.id} className={`parts-group parts-group-${section.id}`}>
              <tr className="group-row">
                <th scope="colgroup" colSpan={COLUMN_COUNT}>
                  <span className="group-title">{section.title}</span>
                  <span className="group-count">{section.rows.length}</span>
                  {section.selectAll && !locked && selectable.length > 1 && (
                    <label className="group-select-all">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        disabled={busy}
                        onChange={(e) => onToggleAll(selectable.map((r) => r.rowId), e.target.checked)}
                      />
                      Select all
                    </label>
                  )}
                </th>
              </tr>
              {section.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="table-empty">
                    {viewOnly
                      ? `No Parts in ${buildName}.`
                      : `No Parts in ${buildName} yet. Tick Parts below, or use Update from CAD.`}
                  </td>
                </tr>
              )}
              {section.rows.map((row) => (
                <DesignerPartRow
                  key={row.rowId}
                  row={row}
                  selectable={!locked && !row.readOnly}
                  selected={selection.has(row.rowId)}
                  onToggle={(checked) => onToggle(row.rowId, checked)}
                  onEdit={(field, value) => onEdit(row.rowId, field, value)}
                  onRetry={() => onRetry(row.rowId)}
                  problem={heldBack.get(row.rowId) ?? null}
                  editable={!locked && !row.readOnly}
                  busy={busy}
                  viewOnly={viewOnly}
                  onRecreate={onRecreate ? () => onRecreate(row) : undefined}
                  recreateBusy={recreatingKey === row.key}
                  recreateBlocked={row.sharedLocked ? recreateBlocked(row) : null}
                  actionsLocked={locked || actionsLocked}
                />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
