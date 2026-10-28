/**
 * Receiving Service — checking parts in when they arrive, and keeping Jira in
 * step with what the purchaser does in the spreadsheet.
 *
 * Covers both in-flight statuses, because the purchaser often marks a row
 * Ordered in the sheet before anyone updates Jira: a ticket can legitimately
 * be sitting in Sent to VFF while its box is already on the doorstep.
 *
 * Grouping is by vendor because vendors ship a whole order in one box, so that
 * is the unit a human actually checks in.
 */

import { badRequest } from '../middleware/httpError.js';
import {
  PARTS_PROJECT_KEY,
  PartField,
  PartStatus,
  PartTransition,
  OrderStatus,
  JIRA_STAGE,
} from '../utils/purchasingConstants.js';
import { normalizeVendor } from '../utils/vendorNormalize.js';
import { lineTotal } from '../utils/purchasingAnalytics.js';
import { planReconciliation, transitionsBetween } from '../utils/reconcile.js';

/** Statuses that represent an order in flight. */
const IN_FLIGHT = [PartStatus.SENT_TO_VFF, PartStatus.ORDERED];

/** "Epic Name" on a Jira Software epic — the short label, not the summary. */
const EPIC_NAME_FIELD = 'customfield_10104';

/** Epic names are effectively static, so cache them for the process lifetime. */
const ASSEMBLY_TTL_MS = 60 * 60 * 1000;

/** How many epics to resolve at once. Small — these are individual GETs. */
const ASSEMBLY_CONCURRENCY = 5;

/** Sheet statuses that mean a human should look before receiving. */
const ATTENTION_SHEET_STATUSES = new Set(['out-of-stock', 'needs attention']);

const RECEIVING_FIELDS = [
  'summary', 'status', 'reporter', 'created', 'updated',
  ...Object.values(PartField),
];

export class ReceivingService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('./orderSheetService.js').OrderSheetService} deps.orderSheetService
   */
  constructor({ jiraClient, orderSheetService }) {
    this.jiraClient = jiraClient;
    this.orderSheetService = orderSheetService;
    /** epicKey -> { key, name, at } */
    this._assemblyCache = new Map();
  }

  // -----------------------------------------------------------------------
  // Read
  // -----------------------------------------------------------------------

  /**
   * The check-in view: a flat list of in-flight tickets, each annotated with
   * where it should end up and what the sheet says about it.
   *
   * Deliberately not grouped here. Whoever is opening the box wants to flip
   * between "what else is in this box", "who do I hand this to" and "which
   * assembly is this for" — that is a view concern, so the client groups and
   * filters, and this returns the facts.
   *
   * @returns {Promise<object>}
   */
  async getReceiving() {
    const { tickets, sheetRows, sheetRowsByKey, plan } = await this._load();

    const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));

    // Fold what the sheet says about each ticket onto the ticket itself.
    for (const group of Object.values(plan)) {
      for (const entry of group) {
        const ticket = byKey.get(entry.key);
        if (!ticket) continue;

        ticket.sheetRow = entry.row;
        ticket.sheetStatus = entry.sheetStatus;
        ticket.outcome = entry.outcome;
        ticket.outcomeReason = entry.reason;
        ticket.pendingTransitions = entry.transitions;

        const row = sheetRowsByKey.get(entry.key.toUpperCase());
        ticket.trackingNumber = row?.trackingNumber ?? null;
      }
    }

    const matched = tickets.filter((ticket) => ticket.sheetRow);
    const unmatched = tickets.filter((ticket) => !ticket.sheetRow);

    // Rows the purchaser added straight to the sheet with no Jira ticket
    // behind them. Invisible to a Jira-driven view, but they are real parts
    // that turn up in real boxes, so they belong in the check-in list.
    const sheetOnly = sheetRows
      .filter((row) => !row.jiraKey && row.description)
      .filter((row) => {
        const status = String(row.orderStatus ?? '').trim().toLowerCase();
        return status !== 'delivered';
      })
      .map((row) => this._toSheetOnlyTicket(row));

    return {
      tickets: [...matched, ...sheetOnly],
      unmatched,
      plan: {
        advance: plan.advance,
        attention: plan.attention,
        drift: plan.drift,
      },
      summary: {
        itemCount: tickets.length,
        matchedCount: matched.length,
        unmatchedCount: unmatched.length,
        sheetOnlyCount: sheetOnly.length,
        advanceCount: plan.advance.length,
        attentionCount: plan.attention.length,
        driftCount: plan.drift.length,
      },
      jiraBaseUrl: (process.env.JIRA_URL ?? process.env.JIRA_BASE_URL ?? '').replace(/\/$/, ''),
    };
  }

  // -----------------------------------------------------------------------
  // Check in
  // -----------------------------------------------------------------------

  /**
   * Mark parts delivered: set Order Status on their sheet rows, then walk each
   * ticket to Delivered.
   *
   * The sheet is written first, as one batch, so a sheet failure leaves
   * nothing half-done. Per-ticket transition failures are reported rather than
   * thrown — the row is already marked, so the caller needs to know which
   * tickets still need moving by hand.
   *
   * Both sides of the gap are handled. A Jira ticket with no sheet row moves
   * in Jira only; a sheet row with no Jira ticket (the purchaser bought
   * something that was never requested through Jira) is marked on the sheet
   * only. Either way the response says which happened.
   *
   * @param {object} params
   * @param {string[]} [params.keys]   Jira issue keys
   * @param {number[]} [params.rows]   Sheet rows that carry no Jira key
   * @returns {Promise<{ received: object[], errors: object[], rowsUpdated: number }>}
   */
  async checkIn({ keys = [], rows: sheetOnlyRows = [] }) {
    if (!Array.isArray(keys) || !Array.isArray(sheetOnlyRows)) {
      throw badRequest('Check-in expects keys and rows to be arrays');
    }
    if (keys.length === 0 && sheetOnlyRows.length === 0) {
      throw badRequest('Check-in requires at least one key or row');
    }

    const uniqueKeys = [...new Set(keys)];
    const uniqueRows = [...new Set(sheetOnlyRows.map(Number))];
    const { tickets, sheetRows, sheetRowsByKey } = await this._load();
    const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
    const byRow = new Map(sheetRows.map((row) => [row.row, row]));

    const plans = [];

    for (const key of uniqueKeys) {
      const ticket = byKey.get(key);
      if (!ticket) {
        throw badRequest(
          `${key} is not in ${IN_FLIGHT.join(' or ')}. It may have moved since the page loaded — reload and try again.`,
        );
      }

      const jiraStage = JIRA_STAGE[ticket.status];
      const deliveredStage = JIRA_STAGE[PartStatus.DELIVERED];

      // An unmapped status would yield no transitions, so the sheet would be
      // marked Delivered and the ticket left in flight while the UI reported
      // success. Most likely cause: a workflow status renamed in Jira.
      if (jiraStage === undefined) {
        throw badRequest(
          `${key} is in "${ticket.status}", which is not a known step of the ordering `
          + 'workflow, so it cannot be checked in. If a Jira status was renamed, update '
          + 'JIRA_STAGE in utils/purchasingConstants.js.',
        );
      }

      plans.push({
        key,
        sheetRow: sheetRowsByKey.get(key.toUpperCase())?.row ?? null,
        // From Sent to VFF this is Ordered then Delivered; Jira has no direct
        // edge between them.
        transitions: transitionsBetween(jiraStage, deliveredStage),
      });
    }

    for (const row of uniqueRows) {
      const sheetRow = byRow.get(row);

      if (!sheetRow) {
        throw badRequest(`Sheet row ${row} is empty. Reload the page and try again.`);
      }
      if (sheetRow.jiraKey) {
        throw badRequest(
          `Sheet row ${row} belongs to ${sheetRow.jiraKey}, so check it in by its ticket instead — that way Jira is updated too.`,
        );
      }

      // Nothing to transition: there is no ticket.
      plans.push({ key: null, sheetRow: row, transitions: [] });
    }

    const rows = plans.map((p) => p.sheetRow).filter((row) => row !== null);
    const rowsUpdated = await this.orderSheetService.markRowsDelivered(rows);

    const received = [];
    const errors = [];

    for (const plan of plans) {
      try {
        for (const transition of plan.transitions) {
          await this.jiraClient.transitionIssue(plan.key, transition);
        }

        received.push({
          key: plan.key,
          row: plan.sheetRow,
          sheetUpdated: plan.sheetRow !== null,
          note: plan.key === null
            ? `Sheet row ${plan.sheetRow} marked ${OrderStatus.DELIVERED}. It has no Jira ticket, so nothing moved in Jira.`
            : plan.sheetRow === null
              ? 'Moved to Delivered in Jira. No sheet row carries this key, so nothing was updated in the spreadsheet.'
              : null,
        });
      } catch (err) {
        errors.push({
          key: plan.key,
          row: plan.sheetRow,
          error: plan.sheetRow === null
            ? `Jira transition failed: ${err.message}`
            : `Sheet row ${plan.sheetRow} is marked ${OrderStatus.DELIVERED}, but the Jira transition failed: ${err.message}. Move ${plan.key} by hand.`,
        });
      }
    }

    return { received, errors, rowsUpdated };
  }

  // -----------------------------------------------------------------------
  // Sync
  // -----------------------------------------------------------------------

  /**
   * Pull the purchaser's sheet edits into Jira: advance any ticket the sheet
   * has moved past. Forward only — see utils/reconcile.js.
   *
   * @returns {Promise<{ advanced: object[], errors: object[], skipped: object }>}
   */
  async syncFromSheet() {
    const { plan } = await this._load();

    const advanced = [];
    const errors = [];

    for (const entry of plan.advance) {
      try {
        for (const transition of entry.transitions) {
          await this.jiraClient.transitionIssue(entry.key, transition);
        }
        advanced.push({
          key: entry.key,
          from: entry.jiraStatus,
          to: entry.sheetStatus || OrderStatus.ORDERED,
          row: entry.row,
        });
      } catch (err) {
        errors.push({ key: entry.key, row: entry.row, error: err.message });
      }
    }

    return {
      advanced,
      errors,
      skipped: {
        attention: plan.attention.length,
        drift: plan.drift.length,
        unmatched: plan.unmatched.length,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Fetch both sides once and build the reconciliation plan.
   * @private
   */
  async _load() {
    const [issues, sheetRows] = await Promise.all([
      this._searchInFlight(),
      this.orderSheetService.readOrders(),
    ]);

    const sheetRowsByKey = new Map(
      sheetRows
        .filter((row) => row.jiraKey)
        .map((row) => [row.jiraKey.toUpperCase(), row]),
    );

    const tickets = issues.map((issue) => this._toTicket(issue));

    // Where each part should end up. The epic is the assembly/subsystem, and
    // it is the single most useful fact for whoever is opening the box.
    const assemblies = await this._resolveAssemblies(
      [...new Set(tickets.map((t) => t.epic).filter(Boolean))],
    );
    for (const ticket of tickets) {
      ticket.assembly = ticket.epic ? (assemblies.get(ticket.epic) ?? { key: ticket.epic, name: ticket.epic }) : null;
    }

    const plan = planReconciliation({ tickets, sheetRowsByKey });

    return { tickets, sheetRows, sheetRowsByKey, plan };
  }

  /** @private */
  async _searchInFlight() {
    const statuses = IN_FLIGHT.map((status) => `"${status}"`).join(', ');
    const jql =
      `project = ${PARTS_PROJECT_KEY} AND status IN (${statuses}) ORDER BY created ASC`;

    return this.jiraClient.searchIssues(jql, {
      paginate: true,
      maxResults: 100,
      fields: RECEIVING_FIELDS,
    });
  }

  /**
   * Resolve epic keys to assembly names.
   *
   * Deliberately one GET per epic rather than a single `key in (...)` search:
   * Jira omits archived issues from search results, so past-season epics come
   * back empty from JQL while GET resolves them fine. A failed lookup falls
   * back to the bare key rather than dropping the destination entirely.
   *
   * @param {string[]} epicKeys
   * @returns {Promise<Map<string, { key: string, name: string }>>}
   * @private
   */
  async _resolveAssemblies(epicKeys) {
    const now = Date.now();
    const resolved = new Map();
    const missing = [];

    for (const key of epicKeys) {
      const cached = this._assemblyCache.get(key);
      if (cached && now - cached.at < ASSEMBLY_TTL_MS) {
        resolved.set(key, { key: cached.key, name: cached.name });
      } else {
        missing.push(key);
      }
    }

    for (let i = 0; i < missing.length; i += ASSEMBLY_CONCURRENCY) {
      const batch = missing.slice(i, i + ASSEMBLY_CONCURRENCY);

      await Promise.all(batch.map(async (key) => {
        let name = key;
        try {
          const issue = await this.jiraClient.getIssue(key, {
            fields: ['summary', EPIC_NAME_FIELD],
          });
          name = issue.fields?.[EPIC_NAME_FIELD] || issue.fields?.summary || key;
        } catch {
          // Leave the bare key as the label; a missing epic name should not
          // take down the whole check-in page.
        }

        this._assemblyCache.set(key, { key, name, at: Date.now() });
        resolved.set(key, { key, name });
      }));
    }

    return resolved;
  }

  /**
   * Shape a sheet row with no Jira ticket like a ticket, so the check-in UI
   * can search, group and receive it alongside everything else.
   *
   * There is no requester and no epic to look up — that information only
   * exists on a Jira ticket — so the sheet's Classification stands in as a
   * rough destination, and the row is marked as having no ticket rather than
   * pretending the gap is not there.
   *
   * @private
   */
  _toSheetOnlyTicket(row) {
    const ticket = {
      id: `row:${row.row}`,
      key: null,
      sheetOnly: true,
      summary: row.description ?? '',
      partNumber: row.partNumber ?? null,
      vendorRaw: row.vendor ?? null,
      vendor: normalizeVendor(row.vendor),
      qty: row.qty,
      price: row.price,
      link: row.link ?? null,
      epic: null,
      assembly: null,
      classification: row.classification ?? null,
      created: null,
      status: null,
      requestedBy: null,
      sheetRow: row.row,
      sheetStatus: row.orderStatus ?? '',
      trackingNumber: row.trackingNumber ?? null,
      outcome: ATTENTION_SHEET_STATUSES.has(
        String(row.orderStatus ?? '').trim().toLowerCase(),
      ) ? 'attention' : 'sheet-only',
      outcomeReason: `Sheet row ${row.row} has no Jira ticket, so there is no requester or assembly recorded. Checking it in marks the sheet only.`,
      pendingTransitions: [],
    };

    ticket.lineTotal = lineTotal(ticket);
    return ticket;
  }

  /** @private */
  _toTicket(issue) {
    const fields = issue.fields ?? {};
    const price = fields[PartField.PRICE];
    const qty = fields[PartField.QTY];
    const vendorRaw = fields[PartField.VENDOR] ?? null;

    const ticket = {
      id: issue.key,
      key: issue.key,
      sheetOnly: false,
      summary: fields.summary ?? '',
      status: fields.status?.name ?? null,
      partNumber: fields[PartField.PART_NUMBER] ?? null,
      vendorRaw,
      vendor: normalizeVendor(vendorRaw),
      qty: Number.isFinite(qty) ? qty : null,
      price: Number.isFinite(price) ? price : null,
      link: fields[PartField.LINK] ?? null,
      epic: fields[PartField.EPIC_LINK] ?? null,
      assembly: null,
      created: fields.created ?? null,
      // Who asked for the part — the reporter, since assignee is set on only
      // a small fraction of tickets.
      requestedBy: fields.reporter
        ? { name: fields.reporter.name, displayName: fields.reporter.displayName }
        : null,
      sheetRow: null,
      sheetStatus: null,
      trackingNumber: null,
      outcome: null,
      outcomeReason: null,
      pendingTransitions: [],
    };

    ticket.lineTotal = lineTotal(ticket);
    return ticket;
  }
}
