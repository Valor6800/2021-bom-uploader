import InlineSelect from '../ui/InlineSelect.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import { TrackerKey } from '../assembly-shared/AssemblyHeader.jsx';
import { MATERIALS, MACHINERY, POWDERCOAT, THICKNESS, PRIORITIES } from '../../api/client.js';

/** Material from OnShape as text; one that isn't on the list says where to fix it. */
function MaterialCell({ value, invalid }) {
  return (
    <td className="cell-text" data-field="material">
      {value || '—'}
      {invalid && <span className="status-detail">Not a listed material. Change it in OnShape</span>}
    </td>
  );
}

// Material is not here: OnShape sets it, so it is always plain text.
const SELECTS = [
  ['machinery', 'Machinery', MACHINERY],
  ['powdercoat', 'Powdercoat', POWDERCOAT],
  ['thickness', 'Thickness', THICKNESS],
];

export const COLUMN_COUNT = 9;

const BADGE_WORDS = new Set(['New', 'Changed', 'In Build', 'Saved', 'Error', 'Not in any Build']);

/**
 * One Part row in the Designer table: inline-editable fields, a status
 * chip with the CAD change detail, and a per-row error with Retry.
 *
 * Fields show as plain text on a cut Build (`viewOnly`) and on a Part a cut
 * Build uses (`row.sharedLocked`); the latter offers "Re-create for this Build".
 *
 * Material is always text: OnShape sets it. A material that isn't on the list
 * (e.g. "Steel") says to change it in OnShape. Another CAD value that isn't on
 * its list shows as itself ("— pick a machinery") and marks the select aria-invalid.
 *
 * @param {object} props
 * @param {object} props.row               From deriveDesignerRows
 * @param {boolean} props.selectable       Show an enabled checkbox
 * @param {boolean} props.selected
 * @param {(checked: boolean) => void} props.onToggle
 * @param {(field: string, value: any) => void} props.onEdit
 * @param {() => void} props.onRetry
 * @param {{ field: string, error: string }|null} props.problem  Held back before save
 * @param {boolean} props.editable
 * @param {boolean} props.busy             A save is running
 * @param {boolean} [props.viewOnly]       The Build is cut: no checkbox, no inputs
 * @param {() => void} [props.onRecreate]
 * @param {boolean} [props.recreateBusy]   This row's Re-create is running
 * @param {string|null} [props.recreateBlocked]  Why Re-create is off
 * @param {boolean} [props.actionsLocked]  Another action is running, or no Build
 */
export default function DesignerPartRow({
  row, selectable, selected, onToggle, onEdit, onRetry, problem, editable, busy,
  viewOnly = false, onRecreate, recreateBusy = false, recreateBlocked = null, actionsLocked = false,
}) {
  const label = row.fullPartNumber ?? row.summary;
  const failure = row.result && row.result.ok === false ? row.result : null;
  const invalidField = problem?.field ?? failure?.field ?? null;
  const errorId = `row-err-${row.rowId}`;
  const message = problem
    ? `Not saved: ${problem.error}`
    : failure?.error ?? null;
  const showChip = BADGE_WORDS.has(row.status) || row.status === 'In Build';
  const asText = viewOnly || row.sharedLocked;
  const tipId = `recreate-tip-${row.rowId}`;

  return (
    <>
      <tr className={`part-row${failure || problem ? ' part-row-error' : ''}${row.readOnly ? ' part-row-readonly' : ''}`}>
        <td className="cell-check">
          {row.group !== 'inBuild' && !viewOnly && (
            <input
              type="checkbox"
              checked={selected}
              disabled={!selectable || busy}
              onChange={(e) => onToggle(e.target.checked)}
              aria-label={row.isNew ? `Create ${label}` : `Add ${row.key} to this Build`}
            />
          )}
        </td>
        <th scope="row" className="cell-part">
          <span className="part-key">{row.key ? <TrackerKey issueKey={row.key} /> : <span className="text-muted">New</span>}</span>
          <span className="mono-key part-number">{row.fullPartNumber}</span>
          <span className="part-name">{row.name}</span>
        </th>
        {asText ? (
          <>
            <td className="cell-text" data-field="quantity">{row.values.quantity ?? '—'}</td>
            <MaterialCell value={row.values.material} invalid={false} />
            {SELECTS.map(([field]) => (
              <td key={field} className="cell-text" data-field={field}>{row.values[field] || '—'}</td>
            ))}
            <td className="cell-text" data-field="priority">{row.values.priority || '—'}</td>
          </>
        ) : (
          <>
            <td className="cell-qty">
              <input
                type="number"
                min="1"
                step="1"
                className="input-inline input-qty"
                value={row.values.quantity ?? ''}
                disabled={!editable || busy}
                aria-label={`Quantity for ${label}`}
                aria-invalid={invalidField === 'quantity' ? 'true' : undefined}
                aria-describedby={invalidField === 'quantity' && message ? errorId : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  onEdit('quantity', v === '' ? '' : Number(v));
                }}
              />
            </td>
            <MaterialCell
              value={row.values.material}
              invalid={!!row.values.material && !MATERIALS.includes(row.values.material)}
            />
            {SELECTS.map(([field, fieldLabel, options]) => {
              const value = row.values[field] ?? 'None';
              const unlisted = !options.includes(value);
              return (
                <td key={field} className="cell-select">
                  <InlineSelect
                    value={value}
                    options={options}
                    extraOption={unlisted ? { value, label: `${value || '(blank)'} — pick a ${fieldLabel.toLowerCase()}` } : undefined}
                    disabled={!editable || busy}
                    aria-label={`${fieldLabel} for ${label}`}
                    aria-invalid={invalidField === field || unlisted ? 'true' : undefined}
                    aria-describedby={(invalidField === field || unlisted) && message ? errorId : undefined}
                    onChange={(e) => onEdit(field, e.target.value)}
                  />
                </td>
              );
            })}
            <td className="cell-select">
              <InlineSelect
                value={row.values.priority ?? ''}
                options={PRIORITIES}
                extraOption={row.values.priority ? undefined : { value: '', label: 'Not set' }}
                disabled={!editable || busy}
                aria-label={`Priority for ${label}`}
                aria-invalid={invalidField === 'priority' ? 'true' : undefined}
                aria-describedby={invalidField === 'priority' && message ? errorId : undefined}
                onChange={(e) => { if (e.target.value) onEdit('priority', e.target.value); }}
              />
            </td>
          </>
        )}
        <td className="cell-status">
          {showChip ? <Badge status={row.status} /> : <span className="status-text">{row.status}</span>}
          {row.readOnlyLabel && <span className="status-detail">{row.readOnlyLabel}</span>}
          {row.lockedLabel && <span className="status-detail">{row.lockedLabel}</span>}
          {row.changeText && <span className="status-detail">{row.changeText}</span>}
          {row.revisionNote && (
            <span className="status-detail" data-revision-note={row.revisionNote.kind}>{row.revisionNote.text}</span>
          )}
          {row.result?.note && <span className="status-detail">{row.result.note}</span>}
          {row.sharedLocked && !viewOnly && onRecreate && (
            <>
              <span className="status-detail">Design changed? Raise its Revision in OnShape, then Update from CAD.</span>
              <Button
                variant="secondary"
                className="row-recreate"
                onClick={onRecreate}
                ariaDisabled={!!recreateBlocked}
                disabled={recreateBusy || actionsLocked || busy}
                title={recreateBlocked ?? 'For Builds made at the same time. Makes the next Revision here only; OnShape keeps showing the old one.'}
                aria-describedby={recreateBlocked ? tipId : undefined}
                aria-label={`Re-create for this Build: ${label}`}
              >
                {recreateBusy ? 'Re-creating…' : 'Re-create for this Build'}
              </Button>
              {recreateBlocked && <span id={tipId} className="visually-hidden">{recreateBlocked}</span>}
            </>
          )}
        </td>
      </tr>
      {message && (
        <tr className="part-row-message">
          <td />
          <td colSpan={COLUMN_COUNT - 1}>
            <div className="row-error">
              <span id={errorId} className="row-error-text">
                <span aria-hidden="true">⚠ </span>{message}
              </span>
              {failure && !problem && (
                <Button variant="secondary" onClick={onRetry} disabled={busy} aria-label={`Retry ${label}`}>
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
