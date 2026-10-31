import { useRef } from 'react';
import Badge from '../ui/Badge.jsx';
import { buildLabel } from '../../lib/buildNames.js';

export const TABPANEL_ID = 'build-tabpanel';

/** The tab id for a Build, for the panel's aria-labelledby. */
export const tabId = (buildKey) => `build-tab-${buildKey}`;

/**
 * One tab per Build of this Revision (design 3.5), following the WAI-ARIA
 * tabs pattern: roving tabIndex, Left/Right/Home/End move and select.
 * Archived Builds sit behind a "Show archived (n)" toggle at the end.
 *
 * @param {object} props
 * @param {object[]} props.builds          Builds to show, lowest number first
 * @param {string|null} props.selectedKey
 * @param {(key: string) => void} props.onSelect
 * @param {number} props.archivedCount     Archived Builds hidden or shown
 * @param {boolean} props.showArchived
 * @param {() => void} props.onToggleArchived
 * @param {boolean} [props.disabled]       A load failed: no switching
 */
export default function BuildTabs({
  builds, selectedKey, onSelect, archivedCount, showArchived, onToggleArchived, disabled = false,
}) {
  const refs = useRef(new Map());

  const onKeyDown = (e, index) => {
    const last = builds.length - 1;
    let next = null;
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    const target = builds[next];
    refs.current.get(target.key)?.focus();
    onSelect(target.key);
  };

  return (
    <div className="build-tabs no-print">
      <div className="build-tablist" role="tablist" aria-label="Builds">
        {builds.map((build, i) => {
          const selected = build.key === selectedKey;
          return (
            <button
              key={build.key}
              ref={(el) => { if (el) refs.current.set(build.key, el); else refs.current.delete(build.key); }}
              id={tabId(build.key)}
              type="button"
              role="tab"
              className={`build-tab${selected ? ' build-tab-selected' : ''}`}
              aria-selected={selected}
              aria-controls={TABPANEL_ID}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              title={build.summary}
              onClick={() => onSelect(build.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span>{buildLabel(build)}</span>
              {build.status && <Badge status={build.status} />}
            </button>
          );
        })}
      </div>
      {archivedCount > 0 && (
        <button
          type="button"
          className="btn btn-ghost build-tabs-archived"
          aria-pressed={showArchived}
          onClick={onToggleArchived}
        >
          {showArchived ? 'Hide archived' : 'Show archived'} ({archivedCount})
        </button>
      )}
    </div>
  );
}
