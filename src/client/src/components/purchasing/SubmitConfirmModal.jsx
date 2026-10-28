/**
 * Confirmation step before a submission is written.
 *
 * Submitting writes rows into the shared team budget spreadsheet and moves
 * Jira tickets — neither is convenient to undo — so the exact target rows,
 * amounts and budget effects are shown first.
 */

import Button from '../ui/Button.jsx';
import Alert from '../ui/Alert.jsx';
import { usd } from '../../lib/purchasingMath.js';

export default function SubmitConfirmModal({ preview, busy, onCancel, onConfirm }) {
  if (!preview) return null;

  const overspent = preview.projectedBudget.filter(
    (row) => Number.isFinite(row.projectedRemaining) && row.projectedRemaining < 0,
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2 className="card-title">Confirm submission</h2>
        </div>

        <div className="modal-body">
          <p className="mb-4 text-light">
            {preview.lines.length} line{preview.lines.length === 1 ? '' : 's'} totalling{' '}
            <strong>{usd(preview.total)}</strong> will be written to the Orders sheet at{' '}
            <strong>rows {preview.startRow}–{preview.endRow}</strong>, and each ticket will
            move to <strong>Sent to VFF</strong>.
          </p>

          {overspent.length > 0 && (
            <Alert variant="warning">
              This order puts {overspent.map((r) => r.classification).join(', ')} over budget.
            </Alert>
          )}

          <table className="table table-compact">
            <thead>
              <tr>
                <th>Row</th>
                <th>Ticket</th>
                <th>Item</th>
                <th>Vendor</th>
                <th>Source</th>
                <th className="cell-num">Qty</th>
                <th className="cell-num">Unit</th>
                <th>Classification</th>
                <th>Wish-List</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr key={line.jiraKey}>
                  <td>{line.targetRow}</td>
                  <td>{line.jiraKey}</td>
                  <td title={line.description}>{line.description}</td>
                  <td>{line.vendor}</td>
                  <td>{line.source || '—'}</td>
                  <td className="cell-num">{line.qty}</td>
                  <td className="cell-num">{usd(line.price)}</td>
                  <td>{line.classification}</td>
                  <td>{line.wishId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="modal-subhead">Budget after this order</h3>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Classification</th>
                <th className="cell-num">Remaining now</th>
                <th className="cell-num">This order</th>
                <th className="cell-num">Remaining after</th>
              </tr>
            </thead>
            <tbody>
              {preview.projectedBudget
                .filter((row) => row.pending > 0)
                .map((row) => (
                  <tr key={row.classification}>
                    <td>{row.classification}</td>
                    <td className="cell-num">{usd(row.remaining)}</td>
                    <td className="cell-num">−{usd(row.pending)}</td>
                    <td
                      className={
                        Number.isFinite(row.projectedRemaining) && row.projectedRemaining < 0
                          ? 'cell-num budget-over'
                          : 'cell-num'
                      }
                    >
                      {usd(row.projectedRemaining)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {preview.projectedWishList.length > 0 && (
            <>
              <h3 className="modal-subhead">Wish-List buckets after this order</h3>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th className="cell-num">Remaining now</th>
                    <th className="cell-num">This order</th>
                    <th className="cell-num">Remaining after</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.projectedWishList.map((bucket) => (
                    <tr key={bucket.wishId}>
                      <td>{bucket.item}</td>
                      <td className="cell-num">{usd(bucket.remaining)}</td>
                      <td className="cell-num">−{usd(bucket.pending)}</td>
                      <td
                        className={
                          Number.isFinite(bucket.projectedRemaining) && bucket.projectedRemaining < 0
                            ? 'cell-num budget-over'
                            : 'cell-num'
                        }
                      >
                        {usd(bucket.projectedRemaining)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="modal-footer">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="success" onClick={onConfirm} disabled={busy}>
            {busy ? 'Submitting…' : `Write ${preview.lines.length} rows & move tickets`}
          </Button>
        </div>
      </div>
    </div>
  );
}
