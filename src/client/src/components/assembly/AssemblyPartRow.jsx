import Badge from '../ui/Badge.jsx';
import { TrackerKey } from '../assembly-shared/AssemblyHeader.jsx';
import PartThumb from '../assembly-shared/PartThumb.jsx';

export const COLUMN_COUNT = 8;

/** Every Part field, shown as text: a cut Build's Parts never change. */
const TEXT_FIELDS = ['quantity', 'material', 'machinery', 'powdercoat', 'thickness', 'priority'];

function PartCell({ row }) {
  return (
    <th scope="row" className="cell-part">
      <span className="part-cell">
        <PartThumb partKey={row.imageKey} />
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
 * In the selected Build: every field as text, and whether this Build is the
 * Part's current one. In another Build (or none): where it is.
 *
 * @param {object} props
 * @param {object} props.row                 From deriveDesignerRows
 * @param {boolean} props.inBuild
 * @param {{ current: boolean, label: string }} [props.current]  In-Build rows only
 */
export default function AssemblyPartRow({ row, inBuild, current }) {
  if (!inBuild) {
    const where = row.isSpare
      ? 'Spare'
      : row.otherBuildKeys.length ? row.label.replace(/^Also in /, 'in ') : 'Not in any Build';
    return (
      <tr className={`part-row part-row-candidate${row.readOnly ? ' part-row-readonly' : ''}`}>
        <PartCell row={row} />
        <td className="cell-where" colSpan={COLUMN_COUNT - 1}>
          <span className="status-text">{where}</span>
          {row.readOnlyLabel && <span className="status-detail">{row.readOnlyLabel}</span>}
        </td>
      </tr>
    );
  }

  return (
    <tr className={`part-row${row.readOnly ? ' part-row-readonly' : ''}`}>
      <PartCell row={row} />
      {TEXT_FIELDS.map((field) => (
        <td key={field} className="cell-text" data-field={field}>
          {row.stored[field] ?? '—'}
        </td>
      ))}
      <td className="cell-status">
        {current?.current
          ? <Badge status="Current" />
          : current && <span className="status-text">{current.label}</span>}
        {row.readOnlyLabel && <span className="status-detail">{row.readOnlyLabel}</span>}
      </td>
    </tr>
  );
}
