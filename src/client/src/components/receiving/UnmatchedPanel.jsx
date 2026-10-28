/**
 * Tickets in flight in Jira with no row on the Orders sheet.
 *
 * Almost entirely a historical backlog: past-season orders that were never
 * moved to Delivered, plus a few predating the Jira Key column. Shown rather
 * than hidden, because nothing else will ever clear them — but collapsed and
 * out of the main flow, since this is a cleanup job rather than today's box.
 *
 * They can still be checked in; only the Jira side runs, and the result says
 * so explicitly.
 */

import Card from '../ui/Card.jsx';

export default function UnmatchedPanel({
  tickets,
  jiraBaseUrl,
  deliveringId,
  onDeliverOne,
}) {
  if (tickets.length === 0) return null;

  // Newest first: anything recent is far likelier to be real than the backlog.
  const sorted = [...tickets].sort(
    (a, b) => new Date(b.created ?? 0) - new Date(a.created ?? 0),
  );

  return (
    <Card
      title="In Jira, not on the sheet"
      icon="🕳"
      headerRight={<span className="vendor-group-warn">{tickets.length} to clean up</span>}
      collapsible
      defaultCollapsed
    >
      <div className="card-body">
        <p className="tab-note text-dim">
          In flight in Jira but carrying no row on the Orders sheet — mostly
          past-season orders that were never closed out. Checking one in moves the
          Jira ticket only.
        </p>

        <table className="table table-compact">
          <thead>
            <tr>
              <th className="cell-num">Qty</th>
              <th>Part number</th>
              <th>Item</th>
              <th>Hand to</th>
              <th>Assembly</th>
              <th className="cell-num">Ordered</th>
              <th className="cell-num" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((ticket) => (
              <tr key={ticket.id}>
                <td className="cell-qty">{ticket.qty ?? '—'}</td>
                <td className="cell-partnumber">
                  <span className="partnumber">{ticket.partNumber || '—'}</span>
                </td>
                <td className="cell-item">
                  <span title={ticket.summary}>{ticket.summary}</span>
                  <a
                    href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${ticket.key}` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="item-key"
                  >
                    {ticket.key}
                  </a>
                </td>
                <td className="cell-destination">
                  {ticket.requestedBy?.displayName || <span className="text-dim">—</span>}
                </td>
                <td className="cell-destination">
                  {ticket.assembly?.name || <span className="text-dim">not set</span>}
                </td>
                <td className="cell-num">{(ticket.created ?? '').slice(0, 10) || '—'}</td>
                <td className="cell-num">
                  <button
                    type="button"
                    className="deliver-button"
                    disabled={deliveringId !== null}
                    title={`Mark ${ticket.key} delivered in Jira`}
                    onClick={() => onDeliverOne(ticket)}
                  >
                    {deliveringId === ticket.id ? '…' : '✓ Got it'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
