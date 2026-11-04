/**
 * Purchasing Service — the "mentor approved -> submitted to purchaser" flow.
 *
 * Reads the Approved queue out of the Jira PARTS project, groups it by
 * canonical vendor, scores each line for anomalies against the team's own
 * order history, and on submit writes the selected lines into the Orders sheet
 * and transitions the tickets to Sent to VFF.
 */

import { badRequest } from '../middleware/httpError.js';
import {
  PARTS_PROJECT_KEY,
  PartField,
  PartStatus,
  PartTransition,
  CLASSIFICATIONS,
  DEFAULT_CLASSIFICATION,
  DEFAULT_SOURCE,
  SOURCES,
  isValidSource,
} from '../utils/purchasingConstants.js';
import { normalizeVendor, groupByVendor } from '../utils/vendorNormalize.js';
import {
  buildLineTotalScorer,
  lineTotal,
  sumLineTotals,
  normalizePartNumber,
  flagLine,
  hasBlocker,
  projectBudget,
  projectWishList,
} from '../utils/purchasingAnalytics.js';

/** How long the price-history index stays warm. */
const HISTORY_TTL_MS = 10 * 60 * 1000;

/** Fields we need from every Jira issue in the queue. */
const QUEUE_FIELDS = [
  'summary', 'status', 'reporter', 'creator', 'created', 'priority',
  ...Object.values(PartField),
];

/** Minimal field set for the historical price index. */
const HISTORY_FIELDS = [PartField.PART_NUMBER, PartField.PRICE];

export class PurchasingService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('./orderSheetService.js').OrderSheetService} deps.orderSheetService
   */
  constructor({ jiraClient, orderSheetService }) {
    this.jiraClient = jiraClient;
    this.orderSheetService = orderSheetService;
    this._historyCache = null;
  }

  // -----------------------------------------------------------------------
  // Queue
  // -----------------------------------------------------------------------

  /**
   * Build the submit-queue view: vendor groups, per-line anomaly flags,
   * budget figures, and the Wish-List buckets.
   *
   * @returns {Promise<object>}
   */
  async getQueue() {
    const [issues, history, budget, wishList, options, sheetRows] = await Promise.all([
      this._searchByStatus(PartStatus.APPROVED),
      this._getPriceHistory(),
      this.orderSheetService.readBudget(),
      this.orderSheetService.readWishList(),
      this.orderSheetService.readOptions(),
      this.orderSheetService.readOrders(),
    ]);

    // Spot tickets already written to the sheet, so a re-submission cannot
    // double-count the budget.
    const jiraKeyIndex = new Map(
      sheetRows
        .filter((row) => row.jiraKey)
        .map((row) => [row.jiraKey.toUpperCase(), row.row]),
    );

    const lines = issues.map((issue) => this._toLine(issue));

    // Count part-number repeats inside the queue itself.
    const queueCounts = new Map();
    for (const line of lines) {
      const pn = normalizePartNumber(line.partNumber);
      if (pn) queueCounts.set(pn, (queueCounts.get(pn) ?? 0) + 1);
    }

    const scorer = buildLineTotalScorer(history.lineTotals);
    const budgetByClassification = new Map(
      budget.categories.map((row) => [row.classification, row]),
    );

    for (const line of lines) {
      const pn = normalizePartNumber(line.partNumber);

      line.alreadyInSheet = jiraKeyIndex.get(line.key.toUpperCase()) ?? null;
      line.priceHistory = pn ? (history.pricesByPartNumber.get(pn) ?? []) : [];

      line.flags = flagLine({
        line,
        scoreLineTotal: scorer.score,
        historicalPrices: line.priceHistory,
        duplicateCount: pn ? (queueCounts.get(pn) ?? 1) : 1,
        budget: budgetByClassification.get(line.classification) ?? null,
      });

      line.blocked = hasBlocker(line.flags);

      // Already written to the sheet by an earlier submission — surfaced so
      // the UI can exclude it rather than double-booking the budget.
      if (line.alreadyInSheet) {
        line.flags.unshift({
          code: 'already-submitted',
          severity: 'blocker',
          label: `Already row ${line.alreadyInSheet}`,
          detail: `${line.key} is already on the Orders sheet at row ${line.alreadyInSheet}. Submitting again would double-count it.`,
        });
        line.blocked = true;
      }
    }

    const vendorGroups = groupByVendor(lines, (line) => line.vendorRaw)
      .map((group) => ({
        vendor: group.vendor,
        items: group.items,
        ...sumLineTotals(group.items),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      vendorGroups,
      summary: {
        ...sumLineTotals(lines),
        itemCount: lines.length,
        blockedCount: lines.filter((l) => l.blocked).length,
        flaggedCount: lines.filter((l) => l.flags.length > 0 && !l.blocked).length,
      },
      budget,
      wishList,
      options: {
        classifications: options.classifications.length ? options.classifications : CLASSIFICATIONS,
        sources: SOURCES,
      },
      history: {
        medianLineTotal: scorer.median,
        sampleSize: history.lineTotals.length,
      },
      // Lets the UI deep-link to a ticket without duplicating the Jira host.
      jiraBaseUrl: (process.env.JIRA_URL ?? process.env.JIRA_BASE_URL ?? '').replace(/\/$/, ''),
    };
  }

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------

  /**
   * Preview a submission without writing anything: resolves the target sheet
   * rows and the projected budget so the UI can confirm before acting.
   *
   * @param {object} params
   * @param {{ key: string, classification: string, wishId: *, source: * }[]} params.rows
   * @returns {Promise<object>}
   */
  async previewSubmission({ rows }) {
    const { lines } = await this._resolveSubmission({ rows });

    const [budget, wishList, startRow] = await Promise.all([
      this.orderSheetService.readBudget(),
      this.orderSheetService.readWishList(),
      this.orderSheetService.findNextWritableRow(),
    ]);

    return {
      startRow,
      endRow: startRow + lines.length - 1,
      // The black order-date row written after the last line.
      dateRow: startRow + lines.length,
      lines: lines.map((line, offset) => ({ ...line, targetRow: startRow + offset })),
      ...sumLineTotals(lines),
      projectedBudget: projectBudget(budget.categories, lines),
      projectedWishList: projectWishList(wishList, lines),
    };
  }

  /**
   * Submit the selected lines: write them to the Orders sheet, then transition
   * each ticket Approved -> Sent to VFF.
   *
   * The sheet write happens first and as a single batch. If it fails, nothing
   * has been written and no ticket has moved. Transitions are then applied per
   * ticket, and a failure there is reported rather than thrown — the row is
   * already on the sheet, so the caller needs to know which tickets still need
   * moving by hand.
   *
   * @param {object} params
   * @param {{ key: string, classification: string, wishId: *, source: * }[]} params.rows
   * @returns {Promise<{ startRow: number, endRow: number, dateRow: number, orderDate: string,
   *   submitted: object[], errors: object[] }>}
   */
  async submit({ rows }) {
    const { lines } = await this._resolveSubmission({ rows });

    const { startRow, endRow, dateRow, orderDate, assignments } =
      await this.orderSheetService.writeOrderRows({ lines });

    const rowByKey = new Map(assignments.map((a) => [a.jiraKey, a.row]));
    const submitted = [];
    const errors = [];

    for (const line of lines) {
      const sheetRow = rowByKey.get(line.jiraKey);

      try {
        await this.jiraClient.transitionIssue(line.jiraKey, PartTransition.SENT_TO_VFF);
        submitted.push({ key: line.jiraKey, row: sheetRow, transitioned: true });
      } catch (err) {
        errors.push({
          key: line.jiraKey,
          row: sheetRow,
          error: `Written to sheet row ${sheetRow}, but the Jira transition failed: ${err.message}. Move it to Sent to VFF by hand.`,
        });
      }
    }

    return { startRow, endRow, dateRow, orderDate, submitted, errors };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Validate a submission request and resolve it into writable sheet lines.
   * @private
   */
  async _resolveSubmission({ rows }) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw badRequest('Submission requires a non-empty rows array');
    }

    const requested = new Map();
    for (const row of rows) {
      if (!row?.key) throw badRequest('Every submission row requires a Jira key');
      if (requested.has(row.key)) {
        throw badRequest(`${row.key} appears more than once in the submission`);
      }
      requested.set(row.key, row);
    }

    const [issues, jiraKeyIndex, wishList, options] = await Promise.all([
      this._searchByStatus(PartStatus.APPROVED),
      this.orderSheetService.buildJiraKeyIndex(),
      this.orderSheetService.readWishList(),
      this.orderSheetService.readOptions(),
    ]);

    const validClassifications = options.classifications.length
      ? options.classifications
      : CLASSIFICATIONS;
    const validWishIds = new Set(wishList.map((b) => b.wishId));
    const issueByKey = new Map(issues.map((issue) => [issue.key, issue]));

    const scorer = buildLineTotalScorer((await this._getPriceHistory()).lineTotals);
    const lines = [];

    for (const [key, request] of requested) {
      const issue = issueByKey.get(key);
      if (!issue) {
        throw badRequest(
          `${key} is not in the Approved queue. It may have been moved since the page loaded — reload and try again.`,
        );
      }

      const existingRow = jiraKeyIndex.get(key.toUpperCase());
      if (existingRow) {
        throw badRequest(
          `${key} is already on the Orders sheet at row ${existingRow}. Submitting it again would double-count the budget.`,
        );
      }

      const line = this._toLine(issue);

      const flags = flagLine({ line, scoreLineTotal: scorer.score });
      if (hasBlocker(flags)) {
        const reasons = flags
          .filter((f) => f.severity === 'blocker')
          .map((f) => f.label)
          .join(', ');
        throw badRequest(`${key} cannot be submitted (${reasons}). Fix it in Jira first.`);
      }

      const classification = request.classification ?? DEFAULT_CLASSIFICATION;
      if (!validClassifications.includes(classification)) {
        throw badRequest(
          `${key} has invalid classification "${classification}". Expected one of: ${validClassifications.join(', ')}`,
        );
      }

      // Wish ID 0 is a real bucket, so blankness is tested explicitly.
      let wishId = null;
      if (request.wishId !== null && request.wishId !== undefined && request.wishId !== '') {
        wishId = Number(request.wishId);
        if (!validWishIds.has(wishId)) {
          throw badRequest(`${key} references unknown Wish ID "${request.wishId}"`);
        }
      }

      // Source is chosen per vendor and may legitimately be blank.
      const lineSource = request.source ?? DEFAULT_SOURCE;
      if (!isValidSource(lineSource)) {
        throw badRequest(
          `${key} has invalid source "${lineSource}". Expected one of: ${SOURCES.join(', ')}, or blank`,
        );
      }

      lines.push({
        jiraKey: line.key,
        classification,
        wishId,
        source: lineSource ?? '',
        partNumber: line.partNumber,
        vendor: line.vendor,
        description: line.summary,
        qty: line.qty,
        price: line.price,
        link: line.link,
      });
    }

    return { lines };
  }

  /**
   * Search the PARTS project for issues in a given status.
   * @private
   */
  async _searchByStatus(status) {
    const jql = `project = ${PARTS_PROJECT_KEY} AND status = "${status}" ORDER BY created ASC`;
    return this.jiraClient.searchIssues(jql, {
      paginate: true,
      maxResults: 100,
      fields: QUEUE_FIELDS,
    });
  }

  /**
   * Index historical prices by normalized part number, plus the distribution
   * of historical line totals used for outlier scoring.
   *
   * Cached briefly — it is a full-project scan and does not change often.
   * @private
   */
  async _getPriceHistory() {
    if (this._historyCache && Date.now() - this._historyCache.at < HISTORY_TTL_MS) {
      return this._historyCache.value;
    }

    const jql =
      `project = ${PARTS_PROJECT_KEY} AND status != "${PartStatus.APPROVED}" ORDER BY created ASC`;
    const issues = await this.jiraClient.searchIssues(jql, {
      paginate: true,
      maxResults: 100,
      fields: [...HISTORY_FIELDS, PartField.QTY],
    });

    const pricesByPartNumber = new Map();
    const lineTotals = [];

    for (const issue of issues) {
      const price = issue.fields?.[PartField.PRICE];
      const qty = issue.fields?.[PartField.QTY];
      const pn = normalizePartNumber(issue.fields?.[PartField.PART_NUMBER]);

      if (pn && Number.isFinite(price)) {
        if (!pricesByPartNumber.has(pn)) pricesByPartNumber.set(pn, []);
        pricesByPartNumber.get(pn).push(price);
      }

      const total = lineTotal({ price, qty });
      if (total !== null && total > 0) lineTotals.push(total);
    }

    const value = { pricesByPartNumber, lineTotals };
    this._historyCache = { at: Date.now(), value };
    return value;
  }

  /**
   * Normalize a raw Jira issue into a queue line.
   * @private
   */
  _toLine(issue) {
    const fields = issue.fields ?? {};
    const price = fields[PartField.PRICE];
    const qty = fields[PartField.QTY];
    const vendorRaw = fields[PartField.VENDOR] ?? null;

    const line = {
      key: issue.key,
      summary: fields.summary ?? '',
      partNumber: fields[PartField.PART_NUMBER] ?? null,
      vendorRaw,
      vendor: normalizeVendor(vendorRaw),
      qty: Number.isFinite(qty) ? qty : null,
      price: Number.isFinite(price) ? price : null,
      link: fields[PartField.LINK] ?? null,
      epic: fields[PartField.EPIC_LINK] ?? null,
      priority: fields.priority?.name ?? null,
      created: fields.created ?? null,
      status: fields.status?.name ?? null,
      requestedBy: fields.reporter
        ? { name: fields.reporter.name, displayName: fields.reporter.displayName }
        : null,
      classification: DEFAULT_CLASSIFICATION,
      wishId: null,
    };

    line.lineTotal = lineTotal(line);
    return line;
  }
}
