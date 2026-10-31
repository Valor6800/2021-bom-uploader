import { useId, useState } from 'react';

/**
 * Section container with an optional collapse toggle.
 *
 * When collapsible, only the icon, title and chevron sit inside the toggle
 * button. `headerRight` is a sibling of that button, so controls placed there
 * (e.g. a vendor's Source select) never toggle the card and are never nested
 * inside a <button>. The body wrapper is always rendered so `aria-controls`
 * resolves; collapsed children stay unmounted.
 */
export default function Card({ title, icon, children, collapsible = false, defaultCollapsed = false, headerRight, className = '' }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const bodyId = useId();
  const iconEl = icon && <span className="card-title-icon" aria-hidden="true">{icon}</span>;

  return (
    <div className={`card ${className}`}>
      <div className="card-header no-print">
        <div className="card-header-inner">
          <h2 className="card-title">
            {collapsible ? (
              <button
                type="button"
                className="card-toggle"
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                onClick={() => setCollapsed((c) => !c)}
              >
                {iconEl}
                {title}
                <span className="card-collapse-icon" aria-hidden="true">{collapsed ? '▼' : '▲'}</span>
              </button>
            ) : (
              <>
                {iconEl}
                {title}
              </>
            )}
          </h2>
          <div className="card-header-right">{headerRight}</div>
        </div>
      </div>
      <div id={bodyId} hidden={collapsed}>{!collapsed && children}</div>
    </div>
  );
}
