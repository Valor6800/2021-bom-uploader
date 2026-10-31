import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { buildLabel } from '../../lib/buildNames.js';

/**
 * The Designer's Build chips, "+ New Build", and the selected Build's full
 * name underneath. Scrolls sideways on a narrow screen.
 *
 * @param {object} props
 * @param {object[]} props.builds          Builds to show (Archived already filtered)
 * @param {string|null} props.selectedKey
 * @param {(key: string) => void} props.onSelect
 * @param {() => void} props.onNew
 * @param {boolean} [props.disabled]       Picking is off (a load failed)
 * @param {boolean} [props.newDisabled]    A create is in flight
 * @param {boolean} [props.newOpen]        The New Build form is showing
 */
export default function BuildPicker({
  builds, selectedKey, onSelect, onNew, disabled = false, newDisabled = false, newOpen = false,
}) {
  const selected = builds.find((b) => b.key === selectedKey) ?? null;
  return (
    <section className="build-picker" aria-labelledby="build-picker-label">
      <div className="build-picker-row">
        <h2 id="build-picker-label" className="build-picker-label">Build</h2>
        <div className="build-chips" role="group" aria-label="Builds">
          {builds.map((b) => (
            <button
              key={b.key}
              type="button"
              className={`build-chip${b.key === selectedKey ? ' build-chip-selected' : ''}`}
              aria-pressed={b.key === selectedKey}
              disabled={disabled}
              title={b.summary}
              onClick={() => onSelect(b.key)}
            >
              <span>{buildLabel(b)}</span>
              {b.status && <Badge status={b.status} />}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={onNew}
          disabled={disabled || newDisabled}
          aria-expanded={newOpen}
          aria-controls="new-build-form"
        >
          + New Build
        </Button>
      </div>
      {selected && <p className="build-picker-summary">{selected.summary}</p>}
    </section>
  );
}
