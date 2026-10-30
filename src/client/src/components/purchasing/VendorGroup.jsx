/**
 * One vendor's worth of the approved queue.
 *
 * Grouping is by canonical vendor name, not the raw Jira field — the team's
 * history holds six spellings of "McMaster-Carr" alone, and the purchaser
 * places one order per vendor.
 */

import Card from '../ui/Card.jsx';
import QueueRow from './QueueRow.jsx';
import { usd } from '../../lib/purchasingMath.js';

export default function VendorGroup({
  group,
  selections,
  classifications,
  sources,
  vendorSource,
  wishList,
  jiraBaseUrl,
  onChange,
  onToggleGroup,
  onSourceChange,
}) {
  const selectableKeys = group.items.filter((l) => !l.blocked).map((l) => l.key);
  const allSelected =
    selectableKeys.length > 0 && selectableKeys.every((key) => selections[key]?.selected);
  const someSelected = selectableKeys.some((key) => selections[key]?.selected);

  const headerRight = (
    <span className="vendor-group-meta">
      {/* Funding source belongs to the vendor: one order, one pot of money. */}
      <label
        className="vendor-group-source"
        onClick={(e) => e.stopPropagation()}
        title="Which pot of money this vendor's order is paid from"
      >
        <span>Source</span>
        <select
          className="select-inline"
          value={vendorSource ?? ''}
          onChange={(e) => onSourceChange(group.vendor, e.target.value)}
        >
          <option value="">— none —</option>
          {sources.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <span className="vendor-group-count">
        {group.items.length} item{group.items.length === 1 ? '' : 's'}
      </span>
      <span className="vendor-group-total">{usd(group.total)}</span>
      {group.unpricedCount > 0 && (
        <span className="vendor-group-warn">{group.unpricedCount} unpriced</span>
      )}
    </span>
  );

  return (
    <Card title={group.vendor} icon="📦" headerRight={headerRight} collapsible>
      <div className="card-body">
        <table className="table">
          <thead>
            <tr>
              <th className="cell-check">
                <input
                  type="checkbox"
                  aria-label={`Select every submittable line from ${group.vendor}`}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  disabled={selectableKeys.length === 0}
                  title="Select every submittable line from this vendor"
                  onChange={(e) => onToggleGroup(selectableKeys, e.target.checked)}
                />
              </th>
              <th>Ticket</th>
              <th>Item</th>
              <th>Part #</th>
              <th className="cell-num">Qty</th>
              <th className="cell-num">Unit</th>
              <th className="cell-num">Total</th>
              <th>Classification</th>
              <th>Wish-List bucket</th>
              <th>Requested by</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((line) => (
              <QueueRow
                key={line.key}
                line={line}
                selection={selections[line.key]}
                classifications={classifications}
                wishList={wishList}
                jiraBaseUrl={jiraBaseUrl}
                onChange={onChange}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
