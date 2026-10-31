import { MATERIALS, MACHINERY, POWDERCOAT, THICKNESS } from '../../api/client.js';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import InlineSelect from '../ui/InlineSelect.jsx';
import { TrackerKey } from '../assembly-shared/AssemblyHeader.jsx';
import { isPowdercoatEnabled, isThicknessEnabled } from '../parts/partRules.js';

export const COLUMN_COUNT = 7;

const SELECTS = [
  ['material', 'Material', MATERIALS],
  ['machinery', 'Machinery', MACHINERY],
  ['powdercoat', 'Powdercoat', POWDERCOAT],
  ['thickness', 'Thickness', THICKNESS],
];

function PartCell({ row }) {
  return (
    <th scope="row" className="cell-part">
      <span className="part-key"><TrackerKey issueKey={row.key} /></span>
      <span className="mono-key part-number">{row.fullPartNumber}</span>
      <span className="part-name">{row.name ?? row.summary}</span>
    </th>
  );
}

/**
 * One Part row on the Assembly page (design 3.5).
 *
 * In the selected Build: editable Qty, Material, Machinery, Powdercoat and
 * Thickness, and whether this Build is the Part's current one. In another
 * Build (or none): where it is, with Move here and Re-create here.
 *
 * @param {object} props
 * @param {object} props.row                 From deriveDesignerRows
 * @param {boolean} props.inBuild
 * @param {string} props.buildName           "Build 2"
 * @param {{ current: boolean, label: string }} [props.current]  In-Build rows only
 * @param {{ field: string, error: string }|null} [props.problem]  Held back before save
 * @param {boolean} props.editable
 * @param {boolean} props.saving             A save is running
 * @param {(field: string, value: any) => void} [props.onEdit]
 * @param {() => void} [props.onRetry]
 * @param {() => void} [props.onMove]
 * @param {() => void} [props.onRecreate]
 * @param {'move'|'recreate'|null} [props.actionBusy]  This row's running action
 * @param {boolean} [props.actionsLocked]    Another action is running, or a load failed
 * @param {string|null} [props.recreateBlocked]  Why Re-create is off ("Already re-created as …")
 */
export default function AssemblyPartRow({
  row, inBuild, buildName, current, problem = null, editable, saving,
  onEdit, onRetry, onMove, onRecreate, actionBusy = null, actionsLocked = false, recreateBlocked = null,
}) {
  const label = row.fullPartNumber ?? row.key;
  const failure = row.result && row.result.ok === false ? row.result : null;
  const message = problem ? `Not saved: ${problem.error}` : failure?.error ?? null;
  const invalidField = problem?.field ?? failure?.field ?? null;
  const errorId = `row-err-${row.rowId}`;

  if (!inBuild) {
    const where = row.otherBuildKeys.length ? row.label.replace(/^Also in /, 'in ') : 'Not in any Build';
    const tipId = `recreate-tip-${row.rowId}`;
    return (
      <tr className={`part-row part-row-candidate${row.readOnly ? ' part-row-readonly' : ''}`}>
        <PartCell row={row} />
        <td className="cell-where" colSpan={4}>
          <span className="status-text">{where}</span>
          {row.readOnlyLabel && <span className="status-detail">{row.readOnlyLabel}</span>}
        </td>
        <td className="cell-actions" colSpan={2}>
          {!row.readOnly && (
            <div className="btn-group row-actions">
              <Button
                variant="secondary"
                onClick={onMove}
                disabled={!!actionBusy || actionsLocked || saving}
                aria-label={`Move here: ${row.key} to ${buildName}`}
              >
                {actionBusy === 'move' ? 'Moving…' : 'Move here'}
              </Button>
              <Button
                variant="secondary"
                onClick={onRecreate}
                ariaDisabled={!!recreateBlocked}
                disabled={!!actionBusy || actionsLocked || saving}
                title={recreateBlocked ?? undefined}
                aria-describedby={recreateBlocked ? tipId : undefined}
                aria-label={`Re-create here: ${row.key} for ${buildName}`}
              >
                {actionBusy === 'recreate' ? 'Re-creating…' : 'Re-create here'}
              </Button>
              {recreateBlocked && <span id={tipId} className="visually-hidden">{recreateBlocked}</span>}
            </div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className={`part-row${failure || problem ? ' part-row-error' : ''}${row.readOnly ? ' part-row-readonly' : ''}`}>
        <PartCell row={row} />
        <td className="cell-qty">
          <input
            type="number"
            min="1"
            step="1"
            className="input-inline input-qty"
            value={row.values.quantity ?? ''}
            disabled={!editable || saving}
            aria-label={`Quantity for ${label}`}
            aria-invalid={invalidField === 'quantity' ? 'true' : undefined}
            aria-describedby={invalidField === 'quantity' && message ? errorId : undefined}
            onChange={(e) => {
              const v = e.target.value;
              onEdit('quantity', v === '' ? '' : Number(v));
            }}
          />
        </td>
        {SELECTS.map(([field, fieldLabel, options]) => {
          const value = row.values[field] ?? 'None';
          const unlisted = !options.includes(value);
          const ruleOff = (field === 'powdercoat' && !isPowdercoatEnabled(row.values.material))
            || (field === 'thickness' && !isThicknessEnabled(row.values.material));
          return (
            <td key={field} className="cell-select">
              <InlineSelect
                value={value}
                options={options}
                extraOption={unlisted ? { value, label: `${value || '(blank)'} — pick a ${fieldLabel.toLowerCase()}` } : undefined}
                disabled={!editable || saving || (ruleOff && value === 'None')}
                aria-label={`${fieldLabel} for ${label}`}
                aria-invalid={invalidField === field || unlisted ? 'true' : undefined}
                aria-describedby={(invalidField === field || unlisted) && message ? errorId : undefined}
                onChange={(e) => onEdit(field, e.target.value)}
              />
            </td>
          );
        })}
        <td className="cell-status">
          {row.status === 'Changed' || row.status === 'Saved' || row.status === 'Error'
            ? <Badge status={row.status} />
            : null}
          {current?.current
            ? <Badge status="Current" />
            : current && <span className="status-text">{current.label}</span>}
          {row.readOnlyLabel && <span className="status-detail">{row.readOnlyLabel}</span>}
        </td>
      </tr>
      {message && (
        <tr className="part-row-message">
          <td colSpan={COLUMN_COUNT}>
            <div className="row-error">
              <span id={errorId} className="row-error-text">
                <span aria-hidden="true">⚠ </span>{message}
              </span>
              {failure && !problem && (
                <Button variant="secondary" onClick={onRetry} disabled={saving} aria-label={`Retry ${label}`}>
                  Retry
                </Button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
