/**
 * Check-in — built for whoever is standing over an open box.
 *
 * The flow it serves: pull a part out, type what is printed on it, see who
 * asked for it and which assembly it belongs to, tick it off. So search is the
 * first thing on the page, the rows carry destination rather than cost, and the
 * list can be regrouped between the three questions that actually come up —
 * what else is in this box, who do I hand this to, which assembly is it for.
 *
 * Shows both in-flight statuses together, because the purchaser orders in the
 * spreadsheet before anyone updates Jira: a part can arrive while its ticket
 * still says Sent to VFF.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/index.js';
import {
  fetchReceiving,
  checkInDeliveries,
  syncFromSheet as requestSync,
} from '../api/client.js';
import Card from '../components/ui/Card.jsx';
import SignInRequired from '../components/ui/SignInRequired.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import ReceivingToolbar from '../components/receiving/ReceivingToolbar.jsx';
import ReceivingGroup from '../components/receiving/ReceivingGroup.jsx';
import UnmatchedPanel from '../components/receiving/UnmatchedPanel.jsx';
import { filterTickets, groupTickets } from '../lib/receivingView.js';

export default function ReceivingPage() {
  const receiving = useAppStore((s) => s.receiving);
  const receivingLoading = useAppStore((s) => s.receivingLoading);
  const receivingError = useAppStore((s) => s.receivingError);
  const checkInResult = useAppStore((s) => s.checkInResult);
  const checkInError = useAppStore((s) => s.checkInError);
  const syncResult = useAppStore((s) => s.syncResult);
  const syncing = useAppStore((s) => s.syncing);
  const search = useAppStore((s) => s.search);
  const groupBy = useAppStore((s) => s.groupBy);

  const setReceiving = useAppStore((s) => s.setReceiving);
  const setReceivingLoading = useAppStore((s) => s.setReceivingLoading);
  const setReceivingError = useAppStore((s) => s.setReceivingError);
  const setCheckInResult = useAppStore((s) => s.setCheckInResult);
  const setCheckInError = useAppStore((s) => s.setCheckInError);
  const setSyncing = useAppStore((s) => s.setSyncing);
  const setSyncResult = useAppStore((s) => s.setSyncResult);
  const setSearch = useAppStore((s) => s.setSearch);
  const setGroupBy = useAppStore((s) => s.setGroupBy);
  const deliveringId = useAppStore((s) => s.deliveringId);
  const setDeliveringId = useAppStore((s) => s.setDeliveringId);

  /** Bumped to pull focus back to the search box after a receive. */
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);

  const load = useCallback(async () => {
    setReceivingLoading(true);
    try {
      setReceiving(await fetchReceiving());
    } catch (err) {
      setReceivingError(err.authRequired ? { authRequired: true, forbidden: err.forbidden, message: err.message } : err.message);
    }
  }, [setReceiving, setReceivingLoading, setReceivingError]);

  useEffect(() => { load(); }, [load]);

  const tickets = receiving?.tickets ?? [];

  const filtered = useMemo(() => filterTickets(tickets, search), [tickets, search]);
  const groups = useMemo(() => groupTickets(filtered, groupBy), [filtered, groupBy]);

  /**
   * Receive a single line. No confirmation dialog: this is the action someone
   * repeats while emptying a box, and a modal per item would defeat the point.
   * The result banner reports what changed.
   *
   * A line is either a Jira ticket or a bare sheet row the purchaser bought
   * without one, so it goes into whichever half of the payload applies.
   */
  const handleDeliverOne = async (ticket) => {
    setDeliveringId(ticket.id);
    try {
      const payload = ticket.key
        ? { keys: [ticket.key] }
        : { rows: [ticket.sheetRow] };

      setCheckInResult(await checkInDeliveries(payload));

      // That part is dealt with — reset for the next thing out of the box.
      // Only on success: a failed receive keeps the search so the row that
      // went wrong stays on screen.
      if (search) {
        setSearch('');
        setSearchFocusSignal((n) => n + 1);
      }

      await load();
    } catch (err) {
      setCheckInError(err.message);
    } finally {
      setDeliveringId(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      setSyncResult(await requestSync());
      await load();
    } catch (err) {
      setSyncResult({ advanced: [], errors: [{ key: '—', error: err.message }] });
    }
  };


  if (receivingLoading && !receiving) {
    return (
      <Card title="Parts Check-in" icon="📬">
        <div className="card-body"><p className="text-light">Loading orders in flight…</p></div>
      </Card>
    );
  }

  if (receivingError?.authRequired) {
    return (
      <SignInRequired
        title="Parts Check-in"
        forbidden={receivingError.forbidden}
        message={receivingError.message}
        returnTo="/receiving"
      />
    );
  }

  if (receivingError) {
    return (
      <Card title="Parts Check-in" icon="📬">
        <div className="card-body">
          <Alert variant="error">{String(receivingError)}</Alert>
          <Button onClick={load}>Retry</Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <ReceivingToolbar
        query={search}
        onQueryChange={setSearch}
        focusSignal={searchFocusSignal}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        showing={filtered.length}
        total={tickets.length}
        syncing={syncing}
        onSync={handleSync}
      />

      {syncResult && (
        <Alert variant={syncResult.errors.length > 0 ? 'warning' : 'info'}>
          {syncResult.advanced.length === 0
            ? 'Nothing to advance — Jira already matches the sheet.'
            : `Advanced ${syncResult.advanced.length} ticket(s): ${syncResult.advanced
                .map((m) => `${m.key} → ${m.to}`)
                .join(', ')}.`}
          {syncResult.errors.length > 0
            && ` ${syncResult.errors.length} failed: ${syncResult.errors
              .map((e) => `${e.key} (${e.error})`)
              .join('; ')}`}
        </Alert>
      )}

      {checkInError && <Alert variant="error">{checkInError}</Alert>}

      {checkInResult && (
        <Alert variant={checkInResult.errors.length > 0 ? 'warning' : 'info'}>
          Checked in {checkInResult.received.length} line
          {checkInResult.received.length === 1 ? '' : 's'}
          {checkInResult.rowsUpdated > 0 && `, updating ${checkInResult.rowsUpdated} sheet row(s)`}.
          {checkInResult.received.some((r) => r.note)
            && ` ${checkInResult.received.filter((r) => r.note).map((r) => `${r.key}: ${r.note}`).join(' ')}`}
          {checkInResult.errors.length > 0
            && ` ${checkInResult.errors.length} failed: ${checkInResult.errors
              .map((e) => `${e.key} (${e.error})`)
              .join('; ')}`}
        </Alert>
      )}

      {tickets.length === 0 ? (
        <Card title="Nothing in flight" icon="✅">
          <div className="card-body">
            <p className="text-light">No orders on the sheet are waiting to be received.</p>
          </div>
        </Card>
      ) : groups.length === 0 ? (
        <Card title="No match" icon="🔍">
          <div className="card-body">
            <p className="text-light">
              Nothing in flight matches “{search}”. It may already be checked in, or never
              ordered — try a shorter search.
            </p>
          </div>
        </Card>
      ) : (
        groups.map((group) => (
          <ReceivingGroup
            key={`${group.mode}:${group.label}`}
            group={group}
            jiraBaseUrl={receiving.jiraBaseUrl}
            deliveringId={deliveringId}
            onDeliverOne={handleDeliverOne}
          />
        ))
      )}

      <UnmatchedPanel
        tickets={receiving?.unmatched ?? []}
        jiraBaseUrl={receiving?.jiraBaseUrl}
        deliveringId={deliveringId}
        onDeliverOne={handleDeliverOne}
      />

    </>
  );
}
