/**
 * Sticky action bar for the parts order: what is selected, what it costs, what
 * it leaves in the budget, and the button that starts the submission.
 *
 * The remaining-budget figure lives here rather than in the budget panel so it
 * stays on screen while scrolling a long queue — it is the number that decides
 * whether to submit.
 */

import Button from '../ui/Button.jsx';
import { usd } from '../../lib/purchasingMath.js';

export default function SubmitBar({
  selectedCount,
  total,
  budgetTotal,
  overspentBucketCount,
  busy,
  onClear,
  onSubmit,
}) {
  const { remaining, pending, projectedRemaining } = budgetTotal;
  const over = Number.isFinite(projectedRemaining) && projectedRemaining < 0;

  return (
    <div className="submit-bar no-print">
      <div className="submit-bar-inner">
        <div className="submit-bar-summary">
          <strong>{selectedCount}</strong> selected
          <span className="submit-bar-sep">·</span>
          <strong>{usd(total)}</strong>
        </div>

        <div className="submit-bar-budget">
          <span className="submit-bar-budget-label">Remaining budget</span>
          <span className={`submit-bar-budget-value${over ? ' budget-over' : ''}`}>
            {usd(projectedRemaining)}
          </span>
          {pending > 0 && (
            <span className="submit-bar-budget-sub">
              was {usd(remaining)} &middot; −{usd(pending)}
            </span>
          )}
        </div>

        <div className="submit-bar-actions">
          {overspentBucketCount > 0 && (
            <span className="submit-bar-warn">
              {overspentBucketCount} Wish-List bucket
              {overspentBucketCount === 1 ? '' : 's'} over
            </span>
          )}

          <Button variant="secondary" onClick={onClear} disabled={selectedCount === 0 || busy}>
            Clear
          </Button>

          <Button onClick={onSubmit} disabled={selectedCount === 0 || busy}>
            {busy ? 'Working…' : 'Submit to purchaser'}
          </Button>
        </div>
      </div>
    </div>
  );
}
