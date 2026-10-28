/**
 * Submit queue — review the mentor-approved part orders, group them by vendor,
 * check the analytics, then hand a selection to the purchaser.
 *
 * Submitting writes rows into the Orders sheet and moves each ticket from
 * Approved to Sent to VFF.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/index.js';
import {
  fetchPurchasingQueue,
  previewSubmission,
  submitPurchaseOrders,
} from '../api/client.js';
import Card from '../components/ui/Card.jsx';
import SignInRequired from '../components/ui/SignInRequired.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import BudgetPanel from '../components/purchasing/BudgetPanel.jsx';
import VendorGroup from '../components/purchasing/VendorGroup.jsx';
import SubmitBar from '../components/purchasing/SubmitBar.jsx';
import SubmitConfirmModal from '../components/purchasing/SubmitConfirmModal.jsx';
import {
  projectBudget,
  projectVouchers,
  projectWishList,
  projectTotalRemaining,
  sumLines,
  untrackedSpend,
  withWishListAffordability,
} from '../lib/purchasingMath.js';

export default function PurchasingQueuePage() {
  const queue = useAppStore((s) => s.queue);
  const queueLoading = useAppStore((s) => s.queueLoading);
  const queueError = useAppStore((s) => s.queueError);
  const selections = useAppStore((s) => s.selections);
  const vendorSources = useAppStore((s) => s.vendorSources);
  const submitPhase = useAppStore((s) => s.submitPhase);
  const submitPreview = useAppStore((s) => s.submitPreview);
  const submitResult = useAppStore((s) => s.submitResult);
  const submitError = useAppStore((s) => s.submitError);

  const setQueue = useAppStore((s) => s.setQueue);
  const setQueueLoading = useAppStore((s) => s.setQueueLoading);
  const setQueueError = useAppStore((s) => s.setQueueError);
  const setVendorSource = useAppStore((s) => s.setVendorSource);
  const updateSelection = useAppStore((s) => s.updateSelection);
  const setManySelected = useAppStore((s) => s.setManySelected);
  const clearSelections = useAppStore((s) => s.clearSelections);
  const setSubmitPhase = useAppStore((s) => s.setSubmitPhase);
  const setSubmitPreview = useAppStore((s) => s.setSubmitPreview);
  const setSubmitResult = useAppStore((s) => s.setSubmitResult);
  const setSubmitError = useAppStore((s) => s.setSubmitError);
  const resetSubmission = useAppStore((s) => s.resetSubmission);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      setQueue(await fetchPurchasingQueue());
    } catch (err) {
      setQueueError(err.authRequired ? { authRequired: true, forbidden: err.forbidden, message: err.message } : err.message);
    }
  }, [setQueue, setQueueLoading, setQueueError]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // --- Derived selection state -------------------------------------------
  const allLines = useMemo(
    () => (queue?.vendorGroups ?? []).flatMap((group) => group.items),
    [queue],
  );

  const selectedLines = useMemo(
    () =>
      allLines
        .filter((line) => selections[line.key]?.selected)
        .map((line) => ({
          ...line,
          classification: selections[line.key].classification,
          wishId: selections[line.key].wishId,
          source: vendorSources[line.vendor] ?? '',
        })),
    [allLines, selections, vendorSources],
  );

  const selectionTotals = useMemo(() => sumLines(selectedLines), [selectedLines]);

  const projectedBudget = useMemo(
    () => projectBudget(queue?.budget?.categories ?? [], selectedLines),
    [queue, selectedLines],
  );

  const projectedVouchers = useMemo(
    () => projectVouchers(queue?.budget?.vouchers ?? [], selectedLines),
    [queue, selectedLines],
  );

  const untracked = useMemo(
    () => untrackedSpend(queue?.budget?.categories ?? [], selectedLines),
    [queue, selectedLines],
  );

  const budgetTotal = useMemo(
    () => projectTotalRemaining(queue?.budget?.total, projectedBudget),
    [queue, projectedBudget],
  );

  /**
   * Wish-List buckets with this order folded in, then walked through the
   * sheet's "If we spent today?" waterfall so each bucket knows whether the
   * remaining budget still reaches it.
   */
  const projectedWishList = useMemo(
    () => withWishListAffordability(
      projectWishList(queue?.wishList ?? [], selectedLines),
      budgetTotal.projectedRemaining,
    ),
    [queue, selectedLines, budgetTotal],
  );

  /** Buckets this order would push past their allocation. */
  const overspentBucketCount = useMemo(
    () =>
      projectedWishList.filter(
        (bucket) =>
          bucket.pending > 0
          && Number.isFinite(bucket.projectedRemaining)
          && bucket.projectedRemaining < 0,
      ).length,
    [projectedWishList],
  );

  // --- Submission ---------------------------------------------------------
  const submissionRows = useMemo(
    () =>
      selectedLines.map((line) => ({
        key: line.key,
        classification: line.classification,
        wishId: line.wishId,
        source: line.source,
      })),
    [selectedLines],
  );

  const handlePreview = async () => {
    resetSubmission();
    setSubmitPhase('previewing');
    try {
      setSubmitPreview(await previewSubmission({ rows: submissionRows }));
    } catch (err) {
      setSubmitError(err.message);
    }
  };

  const handleConfirm = async () => {
    setSubmitPhase('submitting');
    try {
      const result = await submitPurchaseOrders({ rows: submissionRows });
      setSubmitResult(result);
      clearSelections();
      await loadQueue();
    } catch (err) {
      setSubmitError(err.message);
    }
  };

  const busy = submitPhase === 'previewing' || submitPhase === 'submitting';

  // --- Render -------------------------------------------------------------
  if (queueLoading && !queue) {
    return (
      <Card title="Parts Order" icon="🧾">
        <div className="card-body"><p className="text-light">Loading approved orders…</p></div>
      </Card>
    );
  }

  if (queueError?.authRequired) {
    return (
      <SignInRequired
        title="Parts Order"
        forbidden={queueError.forbidden}
        message={queueError.message}
        returnTo="/purchasing"
      />
    );
  }

  if (queueError) {
    return (
      <Card title="Parts Order" icon="🧾">
        <div className="card-body">
          <Alert variant="error">{String(queueError)}</Alert>
          <Button onClick={loadQueue}>Retry</Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <BudgetPanel
        categories={projectedBudget}
        vouchers={projectedVouchers}
        wishList={projectedWishList}
        untracked={untracked}
        hasSelection={selectedLines.length > 0}
      />

      {submitError && <Alert variant="error">{submitError}</Alert>}

      {submitResult && (
        <Alert variant={submitResult.errors.length > 0 ? 'warning' : 'info'}>
          Wrote {submitResult.submitted.length + submitResult.errors.length} row
          {submitResult.submitted.length + submitResult.errors.length === 1 ? '' : 's'} to sheet
          rows {submitResult.startRow}–{submitResult.endRow}.{' '}
          {submitResult.errors.length > 0
            ? `${submitResult.errors.length} ticket(s) need moving by hand: ${submitResult.errors
                .map((e) => `${e.key} (${e.error})`)
                .join('; ')}`
            : 'All tickets moved to Sent to VFF.'}
        </Alert>
      )}

      {allLines.length === 0 ? (
        <Card title="Nothing waiting" icon="✅">
          <div className="card-body">
            <p className="text-light">No mentor-approved orders in the queue.</p>
          </div>
        </Card>
      ) : (
        queue.vendorGroups.map((group) => (
          <VendorGroup
            key={group.vendor}
            group={group}
            selections={selections}
            classifications={queue.options.classifications}
            sources={queue.options.sources}
            vendorSource={vendorSources[group.vendor]}
            wishList={projectedWishList}
            jiraBaseUrl={queue.jiraBaseUrl}
            onChange={updateSelection}
            onToggleGroup={setManySelected}
            onSourceChange={setVendorSource}
          />
        ))
      )}

      <SubmitBar
        selectedCount={selectedLines.length}
        total={selectionTotals.total}
        budgetTotal={budgetTotal}
        overspentBucketCount={overspentBucketCount}
        busy={busy}
        onClear={clearSelections}
        onSubmit={handlePreview}
      />

      {submitPhase === 'confirming' && (
        <SubmitConfirmModal
          preview={submitPreview}
          busy={false}
          onCancel={resetSubmission}
          onConfirm={handleConfirm}
        />
      )}

      {submitPhase === 'submitting' && (
        <SubmitConfirmModal
          preview={submitPreview}
          busy
          onCancel={resetSubmission}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
