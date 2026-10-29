import { MACHINERY, POWDERCOAT, THICKNESS } from '../../api/client.js';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import InlineSelect from '../ui/InlineSelect.jsx';
import { isPowdercoatEnabled, isThicknessEnabled } from '../parts/partRules.js';

/**
 * One row of the Assembly hub's per-build BOM (Sheet 06).
 *
 * A part already linked to the active Build renders as an editable row,
 * same fields Designer can set. A part that only belongs to a sibling
 * Build renders as a lighter candidate row with the two explicit actions —
 * Move (link as-is) or Re-create (new revision) — since neither should
 * happen silently.
 */
export default function HubPartRow({
  part,
  jiraBaseUrl,
  isInActiveBuild,
  isCurrent,
  currentBuildSummary,
  onFieldChange,
  onMove,
  onRecreate,
  busy,
}) {
  if (!isInActiveBuild) {
    return (
      <tr className="row-deselected">
        <td className="whitespace-nowrap font-medium">
          <a href={`${jiraBaseUrl}/browse/${part.key}`} target="_blank" rel="noopener noreferrer" className="link-gold">
            {part.key}
          </a>
        </td>
        <td colSpan={5} className="text-light">{part.summary}</td>
        <td className="whitespace-nowrap">
          <div className="btn-group">
            <Button variant="secondary" onClick={() => onMove(part.key)} disabled={busy}>
              Move to this Build
            </Button>
            <Button variant="secondary" onClick={() => onRecreate(part.key)} disabled={busy}>
              Re-create for this Build
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="whitespace-nowrap font-medium">
        <a href={`${jiraBaseUrl}/browse/${part.key}`} target="_blank" rel="noopener noreferrer" className="link-gold">
          {part.key}
        </a>
      </td>
      <td className="whitespace-nowrap">
        <input
          type="number"
          value={part.quantity || ''}
          onChange={(e) => onFieldChange('quantity', e.target.value)}
          className="input-inline input-number"
        />
      </td>
      <td className="text-light">{part.summary}</td>
      <td className="whitespace-nowrap text-muted">{part.material}</td>
      <td className="whitespace-nowrap">
        <InlineSelect
          value={part.machinery}
          onChange={(e) => onFieldChange('machinery', e.target.value)}
          options={MACHINERY}
        />
      </td>
      <td className="whitespace-nowrap">
        <InlineSelect
          value={part.powdercoat}
          onChange={(e) => onFieldChange('powdercoat', e.target.value)}
          options={POWDERCOAT}
          disabled={!isPowdercoatEnabled(part.material)}
        />
      </td>
      <td className="whitespace-nowrap">
        <InlineSelect
          value={part.thickness}
          onChange={(e) => onFieldChange('thickness', e.target.value)}
          options={THICKNESS}
          disabled={!isThicknessEnabled(part.material)}
        />
      </td>
      <td className="whitespace-nowrap">
        {isCurrent ? (
          <Badge status="Current" />
        ) : (
          <span className="text-dim text-sm">superseded by {currentBuildSummary}</span>
        )}
      </td>
    </tr>
  );
}
