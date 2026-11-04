/**
 * Past orders — the check-in page only shows what is still in flight, so once
 * a part is checked in it drops out of sight. This is where to look it up
 * afterwards: which vendor it came from and who it was handed to.
 *
 * Orders are the blocks the sheet's black order-date rows divide the Orders
 * tab into, newest first. Search spans every order at once and hides orders
 * with nothing matching, so "who got the WCP reamers?" is one query.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrderHistory } from '../api/client.js';
import Card from '../components/ui/Card.jsx';
import SignInRequired from '../components/ui/SignInRequired.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import { filterTickets } from '../lib/receivingView.js';
import { formatOrderDate } from '../lib/orderHistory.js';

/** How many orders start expanded; the rest open on click. */
const EXPANDED_ORDERS = 3;

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function OrderHistoryPage() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await fetchOrderHistory());
    } catch (err) {
      setError(err.authRequired
        ? { authRequired: true, forbidden: err.forbidden, message: err.message }
        : err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const orders = useMemo(
    () => (history?.orders ?? [])
      .map((order) => ({ ...order, shown: filterTickets(order.lines, search) }))
      .filter((order) => order.shown.length > 0),
    [history, search],
  );

  const lineCount = (history?.orders ?? []).reduce((n, o) => n + o.lines.length, 0);
  const shownCount = orders.reduce((n, o) => n + o.shown.length, 0);

  if (error?.authRequired) {
    return (
      <SignInRequired
        title="Past orders"
        forbidden={error.forbidden}
        message={error.message}
        returnTo="/receiving/history"
      />
    );
  }

  if (error) {
    return (
      <Card title="Past orders" icon="🗂️">
        <div className="card-body">
          <Alert variant="error">{String(error)}</Alert>
          <Button onClick={load}>Retry</Button>
        </div>
      </Card>
    );
  }

  if (loading && !history) {
    return (
      <Card title="Past orders" icon="🗂️">
        <div className="card-body"><p className="text-light">Loading past orders…</p></div>
      </Card>
    );
  }

  return (
    <>
      <div className="receiving-toolbar no-print">
        <div className="receiving-search">
          <span className="receiving-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="receiving-search-input"
            placeholder="Part number, item, ticket, vendor, person, assembly…"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
          />
          {search && (
            <button
              type="button"
              className="receiving-search-clear"
              title="Clear search (Esc)"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          )}
        </div>

        <div className="receiving-toolbar-right">
          <span className="receiving-count">
            {search ? `${shownCount} of ${lineCount} lines` : `${history?.orders.length ?? 0} orders`}
          </span>
          <Link to="/receiving" className="btn btn-secondary">Back to check-in</Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card title={search ? 'No match' : 'No orders yet'} icon={search ? '🔍' : '🗂️'}>
          <div className="card-body">
            <p className="text-light">
              {search
                ? `No past order line matches “${search}”.`
                : 'The Orders sheet has no order lines yet.'}
            </p>
          </div>
        </Card>
      ) : (
        orders.map((order, index) => (
          <OrderCard
            // Remount on search so a match inside a collapsed order is shown.
            key={`${order.id}:${search ? 'search' : 'all'}`}
            order={order}
            defaultCollapsed={!search && index >= EXPANDED_ORDERS}
            jiraBaseUrl={history.jiraBaseUrl}
          />
        ))
      )}
    </>
  );
}

function OrderCard({ order, defaultCollapsed, jiraBaseUrl }) {
  const title = order.date
    ? `Ordered ${formatOrderDate(order.date)}`
    : 'Not dated yet';

  const headerRight = (
    <span className="vendor-group-meta">
      {order.vendors.length > 0 && (
        <span className="vendor-group-count" title="Vendors in this order">
          📦 {order.vendors.join(', ')}
        </span>
      )}
      <span className="vendor-group-count">
        {order.lines.length} line{order.lines.length === 1 ? '' : 's'}
      </span>
      <span className="vendor-group-total" title="Sheet total, including shipping">
        {money.format(order.total)}
      </span>
    </span>
  );

  return (
    <Card
      title={title}
      icon="🗂️"
      headerRight={headerRight}
      collapsible
      defaultCollapsed={defaultCollapsed}
    >
      <div className="card-body">
        {!order.date && (
          <p className="text-light">
            These lines are below the last order-date row on the sheet (rows {order.firstRow}–{order.lastRow}).
          </p>
        )}
        <table className="table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th className="cell-num">Qty</th>
              <th>Part number</th>
              <th>Item</th>
              <th>Handed to</th>
              <th>Assembly</th>
              <th className="cell-num">Status</th>
            </tr>
          </thead>
          <tbody>
            {order.shown.map((line) => (
              <tr key={line.id}>
                <td className="cell-destination">{line.vendor || <span className="text-dim">—</span>}</td>

                <td className="cell-qty">{line.qty ?? '—'}</td>

                <td className="cell-partnumber">
                  {line.partNumber ? (
                    <span className="partnumber" title={line.partNumber}>{line.partNumber}</span>
                  ) : (
                    <span className="text-dim">no part #</span>
                  )}
                </td>

                <td className="cell-item">
                  {line.link ? (
                    <a href={line.link} target="_blank" rel="noreferrer" title={line.summary}>
                      {line.summary}
                    </a>
                  ) : (
                    <span title={line.summary}>{line.summary}</span>
                  )}
                  {line.key ? (
                    <a
                      href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${line.key}` : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="item-key"
                      title={`${line.key} · sheet row ${line.sheetRow}`}
                    >
                      {line.key}
                    </a>
                  ) : (
                    <span className="item-key item-key-none">
                      no ticket · sheet row {line.sheetRow}
                    </span>
                  )}
                </td>

                <td className="cell-destination">
                  {line.requestedBy?.displayName || (
                    <span
                      className="text-dim"
                      title={line.key && !line.ticketFound
                        ? `${line.key} was not found in Jira`
                        : 'No Jira ticket, so no requester is recorded'}
                    >
                      —
                    </span>
                  )}
                </td>

                <td className="cell-destination">
                  {line.assembly ? (
                    <span title={line.assembly.key}>{line.assembly.name}</span>
                  ) : line.classification ? (
                    <span className="text-dim" title="From the sheet's Classification — no Jira epic to read">
                      {line.classification}
                    </span>
                  ) : (
                    <span className="text-dim">not set</span>
                  )}
                </td>

                <td className="cell-num">
                  {line.sheetStatus ? (
                    <span
                      className={`flag-chip ${line.sheetStatus === 'Delivered' ? 'flag-chip-info' : 'flag-chip-warning'}`}
                      title={line.status ? `Jira: ${line.status}` : undefined}
                    >
                      {line.sheetStatus}
                    </span>
                  ) : (
                    <span className="text-dim" title={line.status ? `Jira: ${line.status}` : undefined}>
                      not ordered
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
