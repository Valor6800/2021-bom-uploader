/**
 * Sticky toolbar for check-in: find the part, then choose how the list is
 * organized.
 *
 * Search is the primary control and is autofocused, because the normal flow is
 * "pick something out of the box, type what is printed on it". It matches part
 * numbers, item names, ticket keys, vendors, requesters and assemblies at
 * once, so there is nothing to choose before typing.
 */

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Button from '../ui/Button.jsx';
import { GROUP_MODES } from '../../lib/receivingView.js';

export default function ReceivingToolbar({
  query,
  onQueryChange,
  groupBy,
  onGroupByChange,
  showing,
  total,
  syncing,
  focusSignal = 0,
  onSync,
}) {
  const inputRef = useRef(null);

  // Focus on mount, and again whenever the page asks — which it does after a
  // part is received, so the next one can be typed straight in.
  useEffect(() => {
    inputRef.current?.focus();
  }, [focusSignal]);

  return (
    <div className="receiving-toolbar no-print">
      <div className="receiving-search">
        <span className="receiving-search-icon" aria-hidden="true">🔍</span>
        <input
          ref={inputRef}
          type="search"
          className="receiving-search-input"
          placeholder="Part number, item, ticket, vendor, person, assembly…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onQueryChange(''); }}
        />
        {query && (
          <button
            type="button"
            className="receiving-search-clear"
            title="Clear search (Esc)"
            onClick={() => onQueryChange('')}
          >
            ✕
          </button>
        )}
      </div>

      <div className="receiving-toolbar-right">
        <span className="receiving-count">
          {showing === total ? `${total} in flight` : `${showing} of ${total}`}
        </span>

        <div className="segmented" role="group" aria-label="Group by">
          {GROUP_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`segment${groupBy === mode.id ? ' segment-active' : ''}`}
              onClick={() => onGroupByChange(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <Link to="/receiving/history" className="btn btn-secondary">Past orders</Link>

        <Button variant="secondary" onClick={onSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
    </div>
  );
}
