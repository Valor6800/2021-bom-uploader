import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import { fetchActivity } from '../../api/client.js';
import { friendlyClause } from '../../lib/friendlyError.js';
import { ACTION_LABELS, whenText } from '../../lib/activity.js';

/**
 * The Assembly's activity (`?view=activity`): who made, saved, cut and
 * archived its Builds, made spares, asked for files, and added it, newest
 * first. Kept as comments on the Assembly's ticket.
 *
 * @param {object} props
 * @param {object} props.assembly
 * @param {string} props.backTo
 */
export default function ActivityView({ assembly, backTo }) {
  const [state, setState] = useState({ entries: null, error: null });
  const load = useCallback(() => {
    let live = true;
    setState({ entries: null, error: null });
    fetchActivity(assembly.key)
      .then((res) => { if (live) setState({ entries: res.entries ?? [], error: null }); })
      .catch((error) => { if (live) setState({ entries: null, error }); });
    return () => { live = false; };
  }, [assembly.key]);
  useEffect(() => load(), [load]);

  const { entries, error } = state;
  return (
    <section className="activity" aria-labelledby="activity-title">
      <div className="print-view-actions no-print">
        <Link to={backTo} className="btn btn-secondary"><span aria-hidden="true">← </span>Back to BOM</Link>
      </div>
      <h2 id="activity-title" className="build-panel-title">Activity: {assembly.summary}</h2>
      {error && (
        <Alert variant="warning" role="alert" actions={<Button variant="secondary" onClick={load}>Retry</Button>}>
          Couldn&apos;t read the activity: {friendlyClause(error)}
        </Alert>
      )}
      {!error && entries === null && <p className="page-loading" role="status">Reading the activity…</p>}
      {entries?.length === 0 && (
        <p className="status-text">Nothing yet. Making, saving, cutting and archiving Builds, and making spares, show here.</p>
      )}
      {entries?.length > 0 && (
        <table className="table activity-table">
          <caption className="visually-hidden">Activity on {assembly.summary}, newest first</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <td className="cell-text" data-label="When">
                  <time dateTime={e.at ?? undefined} title={e.at ? new Date(e.at).toLocaleString() : undefined}>{whenText(e.at)}</time>
                </td>
                <td className="cell-text" data-label="Who">{e.who}</td>
                <td className="cell-text" data-label="What">
                  <span className="stage-chip stage-not-started activity-kind">{ACTION_LABELS[e.action] ?? e.action}</span>{' '}
                  {e.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
