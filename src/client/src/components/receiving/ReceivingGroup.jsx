/**
 * One group of in-flight parts, in whichever grouping the user picked.
 *
 * The row is built for receiving, not purchasing: part number and quantity
 * (what is printed on the bag, and how many should be in it), then the two
 * facts that decide what happens next — who to hand it to, and which assembly
 * it belongs to. Price, line total, funding source and sheet row are
 * purchasing concerns and are not shown; the sheet row sits in a tooltip for
 * when something needs chasing.
 */

import Card from '../ui/Card.jsx';

const GROUP_ICON = {
  vendor: '📦',
  person: '🙋',
  assembly: '🔧',
};

export default function ReceivingGroup({
  group,
  jiraBaseUrl,
  deliveringId,
  onDeliverOne,
}) {
  const totalQty = group.items.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  const headerRight = (
    <span className="vendor-group-meta">
      {group.trackingNumbers.length > 0 && (
        <span className="tracking-chip" title="Tracking number on these rows">
          📦 {group.trackingNumbers.join(', ')}
        </span>
      )}
      {group.needsAttention > 0 && (
        <span className="vendor-group-warn">{group.needsAttention} needs a look</span>
      )}
      <span className="vendor-group-count">
        {group.items.length} line{group.items.length === 1 ? '' : 's'}
      </span>
      <span className="vendor-group-total">{totalQty} pcs</span>
    </span>
  );

  return (
    <Card
      title={group.label}
      icon={GROUP_ICON[group.mode] ?? '📦'}
      headerRight={headerRight}
      collapsible
    >
      <div className="card-body">
        <table className="table">
          <thead>
            <tr>
              <th className="cell-num">Qty</th>
              <th>Part number</th>
              <th>Item</th>
              <th>Hand to</th>
              <th>Assembly</th>
              <th className="cell-num">Status</th>
              <th className="cell-num" />
            </tr>
          </thead>
          <tbody>
            {group.items.map((ticket) => {
              const flagged = ticket.outcome === 'attention' || ticket.outcome === 'drift';

              return (
                <tr key={ticket.id}>
                  <td className="cell-qty">{ticket.qty ?? '—'}</td>

                  <td className="cell-partnumber">
                    {ticket.partNumber ? (
                      <span className="partnumber" title={ticket.partNumber}>
                        {ticket.partNumber}
                      </span>
                    ) : (
                      <span className="text-dim">no part #</span>
                    )}
                  </td>

                  <td className="cell-item">
                    {ticket.link ? (
                      <a href={ticket.link} target="_blank" rel="noreferrer" title={ticket.summary}>
                        {ticket.summary}
                      </a>
                    ) : (
                      <span title={ticket.summary}>{ticket.summary}</span>
                    )}
                    {ticket.key ? (
                      <a
                        href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${ticket.key}` : undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="item-key"
                        title={
                          ticket.sheetRow
                            ? `${ticket.key} · sheet row ${ticket.sheetRow}`
                            : ticket.key
                        }
                      >
                        {ticket.key}
                      </a>
                    ) : (
                      <span
                        className="item-key item-key-none"
                        title={ticket.outcomeReason}
                      >
                        no ticket · sheet row {ticket.sheetRow}
                      </span>
                    )}
                  </td>

                  <td className="cell-destination">
                    {ticket.requestedBy?.displayName || <span className="text-dim">—</span>}
                  </td>

                  <td className="cell-destination">
                    {ticket.assembly ? (
                      <span title={ticket.assembly.key}>{ticket.assembly.name}</span>
                    ) : ticket.classification ? (
                      <span
                        className="text-dim"
                        title="From the sheet's Classification — no Jira epic to read"
                      >
                        {ticket.classification}
                      </span>
                    ) : (
                      <span className="text-dim">not set</span>
                    )}
                  </td>

                  <td className="cell-num">
                    {flagged ? (
                      <span className="flag-chip flag-chip-warning" title={ticket.outcomeReason}>
                        {ticket.sheetStatus || 'check'}
                      </span>
                    ) : ticket.sheetStatus ? (
                      <span className="flag-chip flag-chip-info" title={`Sheet says ${ticket.sheetStatus}`}>
                        {ticket.sheetStatus}
                      </span>
                    ) : (
                      <span className="text-dim" title={`Jira: ${ticket.status}`}>
                        {ticket.status === 'Ordered' ? 'ordered' : 'awaiting'}
                      </span>
                    )}
                  </td>

                  <td className="cell-num">
                    <button
                      type="button"
                      className="deliver-button"
                      disabled={deliveringId !== null}
                      title={
                        ticket.key
                          ? `Mark ${ticket.key} delivered now`
                          : `Mark sheet row ${ticket.sheetRow} delivered now`
                      }
                      onClick={() => onDeliverOne(ticket)}
                    >
                      {deliveringId === ticket.id ? '…' : '✓ Got it'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
