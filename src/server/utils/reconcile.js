/**
 * Reconciling the Orders sheet against Jira.
 *
 * The purchaser works in the spreadsheet and may mark something Ordered or
 * Delivered long before anyone touches Jira. This decides what to do about
 * that, under one rule: **only ever move a ticket forward**. Anything else —
 * Jira ahead of the sheet, a problem status, a ticket with no row — is
 * reported for a human rather than acted on, because guessing wrong here
 * either loses the purchaser's work or re-opens something already closed.
 *
 * Pure and I/O-free so the decision table is directly testable.
 */

import {
  SHEET_STAGE,
  JIRA_STAGE,
  ATTENTION_STATUSES,
  STAGE_TRANSITIONS,
} from './purchasingConstants.js';

export const Outcome = Object.freeze({
  /** Sheet is ahead; Jira can be advanced to match. */
  ADVANCE: 'advance',
  /** Both sides agree. */
  IN_SYNC: 'in-sync',
  /** Sheet reports a problem; no automatic move. */
  ATTENTION: 'attention',
  /** Jira is ahead of the sheet, or a state we don't model. */
  DRIFT: 'drift',
  /** The ticket has no row on the sheet at all. */
  UNMATCHED: 'unmatched',
});

/**
 * Normalize a sheet Order Status for comparison. The sheet is free-typed in
 * places — historical data holds "delivered", "Ordered  " and
 * "delivered (3 out of 5)" — so matching is case- and whitespace-insensitive,
 * and anything unrecognized is treated as needing a human rather than as
 * blank (which would look like "not yet ordered" and wrongly hold a ticket).
 *
 * @param {*} raw
 * @returns {{ status: string, stage: number|null, recognized: boolean }}
 */
export function normalizeSheetStatus(raw) {
  const trimmed = String(raw ?? '').trim();

  if (trimmed === '') return { status: '', stage: 0, recognized: true };

  const match = Object.keys(SHEET_STAGE).find(
    (known) => known !== '' && known.toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) return { status: match, stage: SHEET_STAGE[match], recognized: true };

  const attention = ATTENTION_STATUSES.find(
    (known) => known.toLowerCase() === trimmed.toLowerCase(),
  );
  if (attention) return { status: attention, stage: null, recognized: true };

  return { status: trimmed, stage: null, recognized: false };
}

/**
 * The transitions needed to climb from one stage to another.
 *
 * @param {number} from
 * @param {number} to
 * @returns {string[]} Transition IDs, in order
 */
export function transitionsBetween(from, to) {
  const steps = [];
  for (let stage = from; stage < to; stage++) {
    const transition = STAGE_TRANSITIONS[stage];
    if (transition) steps.push(transition);
  }
  return steps;
}

/**
 * Decide what should happen to one ticket.
 *
 * @param {object} params
 * @param {{ key: string, status: string }} params.ticket
 * @param {{ row: number, orderStatus: string|null }|null} params.sheetRow
 * @returns {{ outcome: string, transitions: string[], reason: string,
 *   sheetStatus: string|null, row: number|null }}
 */
export function planTicket({ ticket, sheetRow }) {
  if (!sheetRow) {
    return {
      outcome: Outcome.UNMATCHED,
      transitions: [],
      sheetStatus: null,
      row: null,
      reason: `${ticket.key} is in ${ticket.status} but has no row on the Orders sheet, so there is nothing to reconcile against.`,
    };
  }

  const jiraStage = JIRA_STAGE[ticket.status];
  const sheet = normalizeSheetStatus(sheetRow.orderStatus);
  const base = { sheetStatus: sheet.status, row: sheetRow.row };

  if (jiraStage === undefined) {
    return {
      ...base,
      outcome: Outcome.DRIFT,
      transitions: [],
      reason: `${ticket.key} is in "${ticket.status}", which is not part of the ordering pipeline.`,
    };
  }

  if (!sheet.recognized) {
    return {
      ...base,
      outcome: Outcome.ATTENTION,
      transitions: [],
      reason: `Row ${sheetRow.row} has an unrecognized Order Status "${sheet.status}". Left alone — set it to one of the dropdown values.`,
    };
  }

  // Out-of-stock / Needs Attention: a real state, but not a pipeline stage.
  if (sheet.stage === null) {
    return {
      ...base,
      outcome: Outcome.ATTENTION,
      transitions: [],
      reason: `Row ${sheetRow.row} is marked "${sheet.status}". ${ticket.key} was left in ${ticket.status} for you to decide.`,
    };
  }

  if (sheet.stage > jiraStage) {
    const transitions = transitionsBetween(jiraStage, sheet.stage);
    return {
      ...base,
      outcome: Outcome.ADVANCE,
      transitions,
      reason: `Sheet row ${sheetRow.row} says "${sheet.status || 'not yet ordered'}" but ${ticket.key} is still ${ticket.status}.`,
    };
  }

  if (sheet.stage < jiraStage) {
    return {
      ...base,
      outcome: Outcome.DRIFT,
      transitions: [],
      reason: `${ticket.key} is further along (${ticket.status}) than sheet row ${sheetRow.row} ("${sheet.status || 'not yet ordered'}"). Nothing moved — sync only advances tickets.`,
    };
  }

  return {
    ...base,
    outcome: Outcome.IN_SYNC,
    transitions: [],
    reason: `${ticket.key} and sheet row ${sheetRow.row} agree.`,
  };
}

/**
 * Build a reconciliation plan for a set of tickets.
 *
 * @param {object} params
 * @param {{ key: string, status: string }[]} params.tickets
 * @param {Map<string, { row: number, orderStatus: string|null }>} params.sheetRowsByKey
 *   Keyed by upper-cased Jira key
 * @returns {{ advance: object[], attention: object[], drift: object[],
 *   unmatched: object[], inSync: object[] }}
 */
export function planReconciliation({ tickets, sheetRowsByKey }) {
  const plan = { advance: [], attention: [], drift: [], unmatched: [], inSync: [] };

  const bucket = {
    [Outcome.ADVANCE]: plan.advance,
    [Outcome.ATTENTION]: plan.attention,
    [Outcome.DRIFT]: plan.drift,
    [Outcome.UNMATCHED]: plan.unmatched,
    [Outcome.IN_SYNC]: plan.inSync,
  };

  for (const ticket of tickets) {
    const sheetRow = sheetRowsByKey.get(ticket.key.toUpperCase()) ?? null;
    const decision = planTicket({ ticket, sheetRow });
    bucket[decision.outcome].push({ key: ticket.key, jiraStatus: ticket.status, ...decision });
  }

  return plan;
}
