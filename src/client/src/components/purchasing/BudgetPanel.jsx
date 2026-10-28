/**
 * Budget panel — remaining money, broken down three ways, updating live as
 * lines are selected.
 *
 * Tabs rather than one long list because the three breakdowns answer different
 * questions: which category is this coming out of, is there voucher credit
 * left with this vendor, and is this wish-list item still funded.
 *
 * All figures come from the spreadsheet's Overview and Wish-List tabs. Two of
 * its quirks show through deliberately rather than being papered over:
 *   - "VFF" is a valid Classification but has no Overview row, so spend
 *     classified VFF appears in no category here.
 *   - Overview!B5 computes Robot's budget as =B2-B4-B7-B4-B6, subtracting
 *     Tooling twice and omitting Voucher, so Robot reads about $5,800 low.
 */

import { useState } from 'react';
import Card from '../ui/Card.jsx';
import Alert from '../ui/Alert.jsx';
import { usd } from '../../lib/purchasingMath.js';

const TABS = [
  { id: 'category', label: 'By category' },
  { id: 'voucher', label: 'Vouchers' },
  { id: 'wishlist', label: 'Wish-List' },
];

function RemainingCell({ value, pending }) {
  const over = Number.isFinite(value) && value < 0;
  return (
    <td className={`cell-num budget-remaining-cell${over ? ' budget-over' : ''}`}>
      {usd(value)}
      {pending > 0 && <span className="budget-delta"> ↓</span>}
    </td>
  );
}

export default function BudgetPanel({
  categories,
  vouchers,
  wishList,
  untracked,
  hasSelection,
}) {
  const [tab, setTab] = useState('category');

  const touchedWishList = wishList.filter((b) => b.pending > 0);
  const voucherRowsInUse = vouchers.rows.filter((v) => v.pending > 0);

  /** Selected spend that lands in no Overview category at all. */
  const untrackedPending = untracked.reduce((sum, row) => sum + row.pending, 0);

  return (
    <Card title="Budget" icon="💰" collapsible>
      <div className="card-body">
        <div className="tab-strip no-print">
          {TABS.map((item) => {
            const badge =
              item.id === 'voucher'
                ? voucherRowsInUse.length
                : item.id === 'wishlist'
                  ? touchedWishList.length
                  : 0;

            return (
              <button
                key={item.id}
                type="button"
                className={`tab${tab === item.id ? ' tab-active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {badge > 0 && <span className="tab-badge">{badge}</span>}
              </button>
            );
          })}
        </div>

        {tab === 'category' && (
          <>
            {untrackedPending > 0 && (
              <Alert variant="warning">
                {untracked.map((row) => `${row.classification} (${usd(row.pending)})`).join(', ')}{' '}
                {untracked.length === 1 ? 'has' : 'have'} no row on the Overview tab, so that
                spend will not show up in any budget figure — including the remaining budget
                above. Reclassify those lines, or add the category to the sheet.
              </Alert>
            )}

            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="cell-num">Budget</th>
                  <th className="cell-num">Spent</th>
                  {hasSelection && <th className="cell-num">This order</th>}
                  <th className="cell-num">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => (
                  <tr
                    key={row.classification}
                    className={row.pending > 0 ? 'row-touched' : undefined}
                  >
                    <td>{row.classification}</td>
                    <td className="cell-num">{usd(row.budget)}</td>
                    <td className="cell-num">{usd(row.spent)}</td>
                    {hasSelection && (
                      <td className="cell-num">
                        {row.pending > 0 ? `−${usd(row.pending)}` : '—'}
                      </td>
                    )}
                    <RemainingCell
                      value={row.pending > 0 ? row.projectedRemaining : row.remaining}
                      pending={row.pending}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === 'voucher' && (
          <>
            <p className="tab-note text-dim">
              Voucher credit is only drawn down by lines classified{' '}
              <strong>Voucher</strong>, matched to a vendor by exact name.
            </p>

            {vouchers.unmatched.length > 0 && (
              <Alert variant="warning">
                {vouchers.unmatched
                  .map((u) => `${u.vendor} (${usd(u.pending)})`)
                  .join(', ')}{' '}
                {vouchers.unmatched.length === 1 ? 'has' : 'have'} no voucher row on the
                Overview tab, so that spend will count against no voucher allocation.
                Either reclassify those lines or add the vendor to the sheet.
              </Alert>
            )}

            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th className="cell-num">Voucher</th>
                  <th className="cell-num">Used</th>
                  {hasSelection && <th className="cell-num">This order</th>}
                  <th className="cell-num">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.rows.map((row) => (
                  <tr key={row.vendor} className={row.pending > 0 ? 'row-touched' : undefined}>
                    <td>{row.vendor}</td>
                    <td className="cell-num">{usd(row.budget)}</td>
                    <td className="cell-num">{usd(row.spent)}</td>
                    {hasSelection && (
                      <td className="cell-num">
                        {row.pending > 0 ? `−${usd(row.pending)}` : '—'}
                      </td>
                    )}
                    <RemainingCell
                      value={row.pending > 0 ? row.projectedRemaining : row.remaining}
                      pending={row.pending}
                    />
                  </tr>
                ))}
                {vouchers.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      No voucher vendors listed on the Overview tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {tab === 'wishlist' && (
          <>
            <div className="table-scroll">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th className="cell-num">#</th>
                    <th>Item</th>
                    <th>Tier</th>
                    <th className="cell-num">Allocated</th>
                    <th className="cell-num">Spent</th>
                    {hasSelection && <th className="cell-num">This order</th>}
                    <th className="cell-num">Remaining</th>
                    <th className="cell-num">Runs out</th>
                    <th className="cell-num">Funded</th>
                  </tr>
                </thead>
                <tbody>
                  {wishList.map((bucket, index) => {
                    const firstUnfunded =
                      bucket.affordable === false && wishList[index - 1]?.affordable !== false;

                    return (
                      <tr
                        key={bucket.wishId}
                        className={[
                          bucket.pending > 0 ? 'row-touched' : '',
                          bucket.affordable === false ? 'row-unfunded' : '',
                          firstUnfunded ? 'row-cutoff' : '',
                        ].filter(Boolean).join(' ') || undefined}
                      >
                        <td className="cell-num">{bucket.wishId}</td>
                        <td>{bucket.item}</td>
                        <td className="cell-tier">{bucket.notes || '—'}</td>
                        <td className="cell-num">{usd(bucket.allocated)}</td>
                        <td className="cell-num">{usd(bucket.spent)}</td>
                        {hasSelection && (
                          <td className="cell-num">
                            {bucket.pending > 0 ? `−${usd(bucket.pending)}` : '—'}
                          </td>
                        )}
                        <RemainingCell
                          value={bucket.pending > 0 ? bucket.projectedRemaining : bucket.remaining}
                          pending={bucket.pending}
                        />
                        <td
                          className={`cell-num${bucket.affordable === false ? ' budget-over' : ''}`}
                        >
                          {usd(bucket.ifSpentToday)}
                        </td>
                        <td className="cell-num">
                          {bucket.affordable === null ? (
                            '—'
                          ) : bucket.affordable ? (
                            <span className="funded-yes" title="Within the remaining budget">
                              ✓
                            </span>
                          ) : (
                            <span
                              className="funded-no"
                              title="Higher-priority buckets exhaust the remaining budget before this one"
                            >
                              ✕
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
