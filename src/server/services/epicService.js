/**
 * Epic Service — manages Jira epic (Assembly) operations with proper
 * pagination support and epic generation from Onshape URLs.
 */

import { applyTitleMask, applyPartMask } from '../utils/partMask.js';
import { sanitizeJQL } from '../utils/validators.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

/**
 * Regex to parse Onshape document URLs.
 * Expected format: https://cad.onshape.com/documents/{docId}/w/{wsId}/e/{elemId}
 */
const ONSHAPE_URL_REGEX =
  /\/documents\/([a-f0-9]+)\/w\/([a-f0-9]+)\/e\/([a-f0-9]+)/i;

export class EpicService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   */
  constructor({ jiraClient, onshapeClient }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
  }

  /**
   * Retrieve all epics for a season type and year with full pagination.
   *
   * @param {string} seasonType  "R" or "F"
   * @param {string} year        Two-digit year string
   * @returns {Promise<object[]>}
   */
  async getEpics(seasonType, year) {
    const safeSeasonType = sanitizeJQL(seasonType);
    const safeYear = sanitizeJQL(year);
    const jql =
      `project = ${JIRA_PROJECT} AND issuetype = Assembly AND ` +
      `"Epic Name" ~ "V${safeSeasonType}${safeYear}*" AND status not in (Closed, Finished)`;

    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    return this._parseEpics(issues);
  }

  /**
   * Retrieve a single epic by its full part number.
   *
   * @param {string} fullPartNumber  e.g. "VR26A-0001"
   * @returns {Promise<object|null>}
   */
  async getEpic(fullPartNumber) {
    const safe = sanitizeJQL(fullPartNumber);
    const jql =
      `project = ${JIRA_PROJECT} AND issuetype = Assembly AND ` +
      `text ~ "${safe}"`;

    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    const epics = this._parseEpics(issues);
    return epics.find((e) => e.fullPartNumber === fullPartNumber) ?? null;
  }

  /**
   * Retrieve a single epic by its Jira issue key — what the Assembly hub
   * (Sheet 06) needs to resolve a direct /assembly/:key link.
   *
   * @param {string} key  Jira issue key, e.g. "VAL-1"
   * @returns {Promise<object|null>}
   */
  async getEpicByKey(key) {
    const issue = await this.jiraClient.getIssue(key);
    const [epic] = this._parseEpics([issue]);
    return epic ?? null;
  }

  /**
   * Create a Jira epic with Onshape IDs.
   *
   * @param {object} payload
   * @param {string} payload.summary       Full summary string
   * @param {string} [payload.description]
   * @param {string} payload.documentId    Onshape document ID
   * @param {string} payload.workspaceId   Onshape workspace ID
   * @param {string} payload.elementId     Onshape element ID
   * @returns {Promise<{ key: string }>}
   */
  async createEpic(payload) {
    const fields = {
      project: { key: JIRA_PROJECT },
      summary: payload.summary,
      issuetype: { name: 'Assembly' },
      customfield_10104: payload.summary,           // Epic Name
      customfield_10300: payload.documentId,         // Onshape Document ID
      customfield_10301: payload.workspaceId,        // Onshape Workspace ID
      customfield_10302: payload.elementId,          // Onshape Element ID
    };
    if (payload.description) {
      fields.description = payload.description;
    }
    return this.jiraClient.createIssue(fields);
  }

  /**
   * Generate a Jira epic from an Onshape document URL.
   *
   * Parses the URL to extract document/workspace/element IDs, fetches the
   * assembly name from Onshape, and creates the epic in Jira.
   *
   * @param {string} onshapeURL
   * @returns {Promise<{ key: string }>}
   */
  async generateEpicFromURL(onshapeURL) {
    const match = ONSHAPE_URL_REGEX.exec(onshapeURL);
    if (!match) {
      throw new Error(
        `Invalid Onshape URL format. Expected: https://cad.onshape.com/documents/{docId}/w/{wsId}/e/{elemId}`,
      );
    }

    const [, documentId, workspaceId, elementId] = match;

    // Fetch assembly elements to get the name
    const elements = await this.onshapeClient.getElements(
      documentId,
      workspaceId,
      'ASSEMBLY',
    );

    const assembly = elements.find((el) => el.id === elementId);
    const summary = assembly?.name ?? `Assembly ${elementId}`;

    return this.createEpic({
      summary,
      documentId,
      workspaceId,
      elementId,
    });
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Parse raw Jira issues into Epic objects.
   * @private
   */
  _parseEpics(issues) {
    const epics = [];
    for (const issue of issues) {
      const summary = issue.fields?.summary ?? '';
      const parsed = applyTitleMask(summary) ?? applyPartMask(summary);
      if (!parsed) continue;

      epics.push({
        ...parsed,
        key: issue.key,
        documentId: issue.fields?.customfield_10300 ?? null,
        workspaceId: issue.fields?.customfield_10301 ?? null,
        elementId: issue.fields?.customfield_10302 ?? null,
      });
    }
    return epics;
  }
}
