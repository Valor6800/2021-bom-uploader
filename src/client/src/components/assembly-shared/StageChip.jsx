import { stageOf } from '../../lib/partStage.js';

/**
 * Where a Part is in manufacturing: a chip with the stage in words, and the
 * tracker status under it, e.g. "Finishing" / "Powder Coat".
 *
 * @param {object} props
 * @param {string|null} props.status    Tracker status name
 * @param {boolean} [props.compact]     Chip only
 */
export default function StageChip({ status, compact = false }) {
  const stage = stageOf(status);
  return (
    <span className="stage">
      <span className={`stage-chip stage-${stage.id}`}>{stage.label}</span>
      {!compact && status && <span className="stage-detail">{status}</span>}
    </span>
  );
}
