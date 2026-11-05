import { partDrawingUrl } from '../../api/client.js';
import { TrackerKey } from '../assembly-shared/AssemblyHeader.jsx';
import PartThumb from '../assembly-shared/PartThumb.jsx';
import StageChip from '../assembly-shared/StageChip.jsx';

export const COLUMN_COUNT = 9;

/** Every Part field, shown as text: a cut Build's Parts never change. */
const TEXT_FIELDS = ['quantity', 'material', 'machinery', 'powdercoat', 'tapping', 'thickness', 'priority'];
/** Column names, repeated on each cell for the phone layout (cards instead of columns). */
const LABELS = {
  quantity: 'Qty', material: 'Material', machinery: 'Machinery', powdercoat: 'Powdercoat', tapping: 'Tapping', thickness: 'Thickness', priority: 'Priority',
};

/**
 * The Part: its drawing (when the table shows drawings), its picture, and
 * its numbers. A Part without a drawing keeps the drawing's space, so the
 * pictures line up.
 */
function PartCell({ row, drawingKey }) {
  const title = [row.fullPartNumber, row.name ?? row.summary].filter(Boolean).join(' ');
  return (
    <th scope="row" className="cell-part">
      <span className="part-cell">
        {drawingKey !== undefined && (
          <PartThumb partKey={null} src={drawingKey ? partDrawingUrl(drawingKey) : null} title={`${title} drawing`} />
        )}
        <PartThumb partKey={row.imageKey} title={title} />
        <span>
          <span className="part-key"><TrackerKey issueKey={row.key} /></span>
          <span className="mono-key part-number">{row.fullPartNumber}</span>
          <span className="part-name">{row.name ?? row.summary}</span>
        </span>
      </span>
    </th>
  );
}

/**
 * One Part row on the Assembly page (design 3.5), view-only.
 *
 * In the selected Build: every field as text, and where the Part is in
 * manufacturing. In another Build (or none): where it is.
 *
 * @param {object} props
 * @param {object} props.row                 From deriveDesignerRows
 * @param {boolean} props.inBuild
 * @param {{ status: string|null }} [props.tracker]  The Part's tracker status
 * @param {string|null} [props.drawingKey]  The ticket with its drawing; null: none; undefined: drawings not shown
 */
export default function AssemblyPartRow({ row, inBuild, tracker, drawingKey }) {
  if (!inBuild) {
    const where = row.isSpare
      ? 'Spare'
      : row.otherBuildKeys.length ? row.label.replace(/^Also in /, 'in ') : 'Not in any Build';
    return (
      <tr className={`part-row part-row-candidate${row.readOnly ? ' part-row-readonly' : ''}`}>
        <PartCell row={row} drawingKey={drawingKey} />
        <td className="cell-where" colSpan={COLUMN_COUNT - 1}>
          <span className="status-text">{where}</span>
          {row.readOnlyLabel && <span className="status-detail">{row.readOnlyLabel}</span>}
        </td>
      </tr>
    );
  }

  return (
    <tr className={`part-row${row.readOnly ? ' part-row-readonly' : ''}`}>
      <PartCell row={row} drawingKey={drawingKey} />
      <td className="cell-stage" data-label="Status">
        <StageChip status={tracker?.status ?? null} />
        {row.readOnlyLabel && <span className="status-detail">{row.readOnlyLabel}</span>}
      </td>
      {TEXT_FIELDS.map((field) => (
        <td key={field} className="cell-text" data-field={field} data-label={LABELS[field]}>
          {row.stored[field] ?? '—'}
        </td>
      ))}
    </tr>
  );
}
