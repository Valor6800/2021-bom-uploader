import { useState } from 'react';

export default function Card({ title, icon, children, collapsible = false, defaultCollapsed = false, headerRight, className = '' }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`card ${className}`}>
      <div
        className={`card-header ${collapsible ? 'card-header-clickable' : ''} no-print`}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
      >
        <div className="card-header-inner">
          <h2 className="card-title">
            {icon && <span className="card-title-icon">{icon}</span>}
            {title}
          </h2>
          <div className="card-header-right">
            {headerRight}
            {collapsible && (
              <span className="card-collapse-icon">{collapsed ? '▼' : '▲'}</span>
            )}
          </div>
        </div>
      </div>
      {!collapsed && children}
    </div>
  );
}
