import { MACHINERY, POWDERCOAT, THICKNESS } from '../../api/client.js';
import Badge from '../ui/Badge.jsx';
import InlineSelect from '../ui/InlineSelect.jsx';
import { isPowdercoatEnabled, isThicknessEnabled, isStepAutoExport } from './partRules.js';

/**
 * A single editable part row. Presentational: all edits flow up through
 * onFieldChange(field, value) and onToggleSelect().
 */
export default function PartRow({
  story,
  jiraBaseUrl,
  isSelected,
  onToggleSelect,
  onFieldChange,
}) {
  const isNew = story._status === 'New';
  const rowClass = isNew && !isSelected ? 'row-deselected' : '';

  return (
    <tr className={rowClass}>
      <td>
        {isNew && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="preview-checkbox"
          />
        )}
      </td>
      <td className="whitespace-nowrap font-medium">
        {story.key && story.key !== 'N/A' ? (
          <a
            href={`${jiraBaseUrl}/browse/${story.key}`}
            target="_blank"
            rel="noopener noreferrer"
            className="link-gold"
          >
            {story.key}
          </a>
        ) : (
          <span className="text-dim">New</span>
        )}
      </td>
      <td className="whitespace-nowrap">
        <input
          type="number"
          value={story.quantity || ''}
          onChange={(e) => onFieldChange('quantity', e.target.value)}
          className="input-inline input-number"
        />
      </td>
      <td className="text-light">
        {story.summary}
        {isStepAutoExport(story) && (
          <span className="step-indicator">STEP auto-export</span>
        )}
      </td>
      <td className="whitespace-nowrap text-muted">{story.material}</td>
      <td className="whitespace-nowrap">
        <InlineSelect
          value={story.machinery}
          onChange={(e) => onFieldChange('machinery', e.target.value)}
          options={MACHINERY}
        />
      </td>
      <td className="whitespace-nowrap">
        <InlineSelect
          value={story.powdercoat}
          onChange={(e) => onFieldChange('powdercoat', e.target.value)}
          options={POWDERCOAT}
          disabled={!isPowdercoatEnabled(story.material)}
        />
      </td>
      <td className="whitespace-nowrap">
        <InlineSelect
          value={story.thickness}
          onChange={(e) => onFieldChange('thickness', e.target.value)}
          options={THICKNESS}
          disabled={!isThicknessEnabled(story.material)}
        />
      </td>
      <td className="whitespace-nowrap">
        <Badge status={story._status || 'Exists'} />
      </td>
    </tr>
  );
}
