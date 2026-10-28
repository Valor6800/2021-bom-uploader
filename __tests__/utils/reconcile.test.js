import {
  normalizeSheetStatus,
  transitionsBetween,
  planTicket,
  planReconciliation,
  Outcome,
} from '../../src/server/utils/reconcile.js';
import { PartStatus, PartTransition, OrderStatus } from '../../src/server/utils/purchasingConstants.js';

describe('normalizeSheetStatus', () => {
  it('treats blank as stage 0 — handed over but not yet ordered', () => {
    expect(normalizeSheetStatus('')).toEqual({ status: '', stage: 0, recognized: true });
    expect(normalizeSheetStatus(null)).toEqual({ status: '', stage: 0, recognized: true });
    expect(normalizeSheetStatus('   ')).toEqual({ status: '', stage: 0, recognized: true });
  });

  it('ranks the pipeline statuses', () => {
    expect(normalizeSheetStatus('Ordered').stage).toBe(1);
    expect(normalizeSheetStatus('Delivered').stage).toBe(2);
  });

  it('matches case- and whitespace-insensitively, as the sheet is hand-typed', () => {
    // The historical data holds "delivered" and "Ordered  ".
    expect(normalizeSheetStatus('delivered')).toMatchObject({ status: 'Delivered', stage: 2 });
    expect(normalizeSheetStatus('Ordered  ')).toMatchObject({ status: 'Ordered', stage: 1 });
    expect(normalizeSheetStatus('  ORDERED')).toMatchObject({ status: 'Ordered', stage: 1 });
  });

  it('recognizes the problem statuses but gives them no stage', () => {
    expect(normalizeSheetStatus('Out-of-stock')).toEqual({
      status: 'Out-of-stock', stage: null, recognized: true,
    });
    expect(normalizeSheetStatus('Needs Attention')).toEqual({
      status: 'Needs Attention', stage: null, recognized: true,
    });
  });

  it('refuses to guess at free text, rather than reading it as blank', () => {
    // "delivered (3 out of 5)" exists in the historical sheet. Treating it as
    // blank would look like "not yet ordered" and wrongly hold the ticket.
    const result = normalizeSheetStatus('delivered (3 out of 5)');
    expect(result.recognized).toBe(false);
    expect(result.stage).toBeNull();
  });
});

describe('transitionsBetween', () => {
  it('returns a single step for one stage', () => {
    expect(transitionsBetween(0, 1)).toEqual([PartTransition.ORDERED]);
    expect(transitionsBetween(1, 2)).toEqual([PartTransition.DELIVERED]);
  });

  it('walks both steps for a two-stage jump, since Jira has no direct edge', () => {
    expect(transitionsBetween(0, 2)).toEqual([PartTransition.ORDERED, PartTransition.DELIVERED]);
  });

  it('returns nothing when already there or beyond', () => {
    expect(transitionsBetween(2, 2)).toEqual([]);
    expect(transitionsBetween(2, 1)).toEqual([]);
  });
});

describe('planTicket', () => {
  const sentToVff = { key: 'PARTS-1', status: PartStatus.SENT_TO_VFF };
  const ordered = { key: 'PARTS-2', status: PartStatus.ORDERED };

  it('advances Sent to VFF when the sheet says Ordered', () => {
    const plan = planTicket({
      ticket: sentToVff,
      sheetRow: { row: 23, orderStatus: OrderStatus.ORDERED },
    });

    expect(plan.outcome).toBe(Outcome.ADVANCE);
    expect(plan.transitions).toEqual([PartTransition.ORDERED]);
    expect(plan.row).toBe(23);
  });

  it('advances Ordered to Delivered when the sheet says Delivered', () => {
    const plan = planTicket({
      ticket: ordered,
      sheetRow: { row: 24, orderStatus: OrderStatus.DELIVERED },
    });

    expect(plan.outcome).toBe(Outcome.ADVANCE);
    expect(plan.transitions).toEqual([PartTransition.DELIVERED]);
  });

  it('jumps two stages when the purchaser ordered and received before Jira caught up', () => {
    const plan = planTicket({
      ticket: sentToVff,
      sheetRow: { row: 25, orderStatus: OrderStatus.DELIVERED },
    });

    expect(plan.outcome).toBe(Outcome.ADVANCE);
    expect(plan.transitions).toEqual([PartTransition.ORDERED, PartTransition.DELIVERED]);
  });

  it('is in sync when both sides agree', () => {
    expect(planTicket({
      ticket: sentToVff,
      sheetRow: { row: 23, orderStatus: '' },
    }).outcome).toBe(Outcome.IN_SYNC);

    expect(planTicket({
      ticket: ordered,
      sheetRow: { row: 24, orderStatus: OrderStatus.ORDERED },
    }).outcome).toBe(Outcome.IN_SYNC);
  });

  it('never moves backwards when Jira is ahead of the sheet', () => {
    const plan = planTicket({
      ticket: ordered,
      sheetRow: { row: 24, orderStatus: '' },
    });

    expect(plan.outcome).toBe(Outcome.DRIFT);
    expect(plan.transitions).toEqual([]);
  });

  it('leaves Out-of-stock for a human', () => {
    const plan = planTicket({
      ticket: sentToVff,
      sheetRow: { row: 23, orderStatus: OrderStatus.OUT_OF_STOCK },
    });

    expect(plan.outcome).toBe(Outcome.ATTENTION);
    expect(plan.transitions).toEqual([]);
    expect(plan.reason).toMatch(/Out-of-stock/);
  });

  it('leaves Needs Attention for a human', () => {
    expect(planTicket({
      ticket: ordered,
      sheetRow: { row: 24, orderStatus: OrderStatus.NEEDS_ATTENTION },
    }).outcome).toBe(Outcome.ATTENTION);
  });

  it('flags unrecognized free text instead of acting on it', () => {
    const plan = planTicket({
      ticket: sentToVff,
      sheetRow: { row: 23, orderStatus: 'delivered (3 out of 5)' },
    });

    expect(plan.outcome).toBe(Outcome.ATTENTION);
    expect(plan.transitions).toEqual([]);
  });

  it('reports a ticket with no sheet row', () => {
    const plan = planTicket({ ticket: sentToVff, sheetRow: null });

    expect(plan.outcome).toBe(Outcome.UNMATCHED);
    expect(plan.row).toBeNull();
    expect(plan.reason).toMatch(/no row on the Orders sheet/);
  });

  it('flags a Jira status outside the ordering pipeline', () => {
    const plan = planTicket({
      ticket: { key: 'PARTS-9', status: PartStatus.APPROVED },
      sheetRow: { row: 30, orderStatus: OrderStatus.ORDERED },
    });

    expect(plan.outcome).toBe(Outcome.DRIFT);
    expect(plan.transitions).toEqual([]);
  });
});

describe('planReconciliation', () => {
  it('sorts every ticket into its bucket', () => {
    const sheetRowsByKey = new Map([
      ['PARTS-1', { row: 2, orderStatus: OrderStatus.ORDERED }],
      ['PARTS-2', { row: 3, orderStatus: '' }],
      ['PARTS-3', { row: 4, orderStatus: OrderStatus.OUT_OF_STOCK }],
      ['PARTS-4', { row: 5, orderStatus: OrderStatus.ORDERED }],
    ]);

    const plan = planReconciliation({
      tickets: [
        { key: 'PARTS-1', status: PartStatus.SENT_TO_VFF }, // advance
        { key: 'PARTS-2', status: PartStatus.ORDERED },     // drift
        { key: 'PARTS-3', status: PartStatus.SENT_TO_VFF }, // attention
        { key: 'PARTS-4', status: PartStatus.ORDERED },     // in sync
        { key: 'PARTS-5', status: PartStatus.SENT_TO_VFF }, // unmatched
      ],
      sheetRowsByKey,
    });

    expect(plan.advance.map((e) => e.key)).toEqual(['PARTS-1']);
    expect(plan.drift.map((e) => e.key)).toEqual(['PARTS-2']);
    expect(plan.attention.map((e) => e.key)).toEqual(['PARTS-3']);
    expect(plan.inSync.map((e) => e.key)).toEqual(['PARTS-4']);
    expect(plan.unmatched.map((e) => e.key)).toEqual(['PARTS-5']);
  });

  it('matches sheet keys case-insensitively', () => {
    const plan = planReconciliation({
      tickets: [{ key: 'PARTS-7', status: PartStatus.SENT_TO_VFF }],
      sheetRowsByKey: new Map([['PARTS-7', { row: 9, orderStatus: OrderStatus.ORDERED }]]),
    });

    expect(plan.advance).toHaveLength(1);
  });

  it('carries the Jira status through onto each entry', () => {
    const plan = planReconciliation({
      tickets: [{ key: 'PARTS-1', status: PartStatus.SENT_TO_VFF }],
      sheetRowsByKey: new Map([['PARTS-1', { row: 2, orderStatus: OrderStatus.DELIVERED }]]),
    });

    expect(plan.advance[0]).toMatchObject({
      key: 'PARTS-1',
      jiraStatus: PartStatus.SENT_TO_VFF,
      sheetStatus: OrderStatus.DELIVERED,
      row: 2,
    });
  });

  it('handles an empty ticket list', () => {
    const plan = planReconciliation({ tickets: [], sheetRowsByKey: new Map() });
    expect(plan).toEqual({ advance: [], attention: [], drift: [], unmatched: [], inSync: [] });
  });
});
