import { boardPlaceOf, stageOf } from '../../lib/partStage.js';

/**
 * Where a Part is in manufacturing: a chip with the stage in words, and the
 * tracker status and board column under it, e.g.
 * "Finishing" / "Powder Coat · Assembly board".
 *
 * @param {object} props
 * @param {string|null} props.status    Tracker status name
 * @param {string|null} [props.statusId]
 * @param {object} [props.columns]      From useBoardColumns
 * @param {boolean} [props.compact]     Chip only
 */
export default function StageChip({ status, statusId, columns, compact = false }) {
  const stage = stageOf(status);
  const place = boardPlaceOf(statusId, columns);
  return (
    <span className="stage">
      <span className={`stage-chip stage-${stage.id}`}>{stage.label}</span>
      {!compact && (status || place) && (
        <span className="stage-detail" title={place ?? undefined}>
          {place ?? status}
        </span>
      )}
    </span>
  );
}
