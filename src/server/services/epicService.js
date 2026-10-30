/**
 * Epic Service — manages Jira epic (Assembly) operations with proper
 * pagination support and epic generation from Onshape URLs.
 */

import { applyTitleMask, applyPartMask } from '../utils/partMask.js';
import { sanitizeJQL, validateIssueKey } from '../utils/validators.js';
import { RevisionField } from '../utils/buildConstants.js';
import { badRequest, HttpError } from '../middleware/httpError.js';
import {
  ASSEMBLY_FIELDS, KEY_SHAPED_RE, isAssemblyIssue, searchAssemblyList, toAssembly,
} from '../utils/assemblySearch.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

/**
 * Regex to parse Onshape document URLs.
 * Expected format: https://cad.onshape.com/documents/{docId}/w/{wsId}/e/{elemId}
 */
const ONSHAPE_URL_REGEX =
  /\/documents\/([a-f0-9]+)\/w\/([a-f0-9]+)\/e\/([a-f0-9]+)/i;

/**
 * OnShape's built-in element property ids, matched first; the display name is
 * the fallback in case an instance reports a different id.
 */
const ONSHAPE_PROPERTY = Object.freeze({
  NAME: { id: '57f3fb8efa3416c06701d60d', name: 'Name' },
  PART_NUMBER: { id: '57f3fb8efa3416c06701d60f', name: 'Part number' },
  REVISION: { id: '57f3fb8efa3416c06701d610', name: 'Revision' },
  PROJECT: { id: '57f3fb8efa3416c06701d613', name: 'Project' },
});

/**
 * Each property the Assembly number is built from, with the format it must
 * have. Order is the order problems are reported in.
 */
const REQUIRED_ASSEMBLY_PROPERTIES = [
  { prop: ONSHAPE_PROPERTY.PROJECT, pattern: /^V[RF]\d{2}$/, hint: 'V, then R or F, then a 2-digit year, e.g. VF27' },
  { prop: ONSHAPE_PROPERTY.PART_NUMBER, pattern: /^\d{4}$/, hint: '4 digits, e.g. 0001' },
  { prop: ONSHAPE_PROPERTY.REVISION, pattern: /^[A-Z]$/, hint: 'a single letter, e.g. A' },
  { prop: ONSHAPE_PROPERTY.NAME, pattern: /\S/, hint: 'any text' },
];

function readProperty(properties, { id, name }) {
  const entry =
    properties.find((p) => p.propertyId === id) ??
    properties.find((p) => p.name === name);
  const value = entry?.value;
  return typeof value === 'string' ? value.trim() : '';
}

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
   * Retrieve a single Assembly by its tracker key, numbered or not.
   *
   * @param {string} key  Tracker key, e.g. "HAR-2030" (already validated)
   * @returns {Promise<object|null>} the toAssembly shape, or null when the
   *   key belongs to something other than an Assembly
   * @throws {HttpError} 404 when the key doesn't exist
   */
  async getEpicByKey(key) {
    let issue;
    try {
      issue = await this.jiraClient.getIssue(key);
    } catch (err) {
      if (err?.status === 404) throw new HttpError(404, `No Assembly ${key} found`);
      throw err;
    }
    if (!isAssemblyIssue(issue)) return null;
    return this._toAssembly(issue);
  }

  /**
   * Search every Assembly by key, name, number or season (design 3.1.1).
   *
   * One JQL lists the Assembly set; matching and ranking happen in code
   * because JQL can't find a bare number or a season word. A key-shaped
   * query also reads that key directly, which finds a closed Assembly even
   * when closed ones are excluded.
   *
   * @param {string} query  Already stripped of control characters and trimmed
   * @param {object} [options]
   * @param {number} [options.limit=50]
   * @param {boolean} [options.includeClosed=false]
   * @returns {Promise<{ query: string, total: number, results: object[], groups: object[]|null }>}
   */
  async searchAssemblies(query, { limit = 50, includeClosed = false } = {}) {
    // Read the project at call time, as validateIssueKey does, so the list
    // query and the key lookup always target the same project.
    const project = sanitizeJQL(process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL');
    const statusClause = includeClosed ? '' : ' AND status not in (Closed, Finished)';
    const jql =
      `project = ${project} AND issuetype = Assembly${statusClause} ORDER BY created DESC`;

    const [issues, direct] = await Promise.all([
      this.jiraClient.searchIssues(jql, { paginate: true, fields: ASSEMBLY_FIELDS }),
      this._lookupKey(query),
    ]);

    const byKey = new Map();
    for (const issue of issues) byKey.set(issue.key, this._toAssembly(issue));
    if (direct && !byKey.has(direct.key)) byKey.set(direct.key, this._toAssembly(direct));

    return searchAssemblyList([...byKey.values()], query, limit);
  }

  /**
   * Direct read for a key-shaped query. Never fails the search: a missing
   * key or a lookup error just means no extra hit.
   * @private
   */
  async _lookupKey(query) {
    if (!KEY_SHAPED_RE.test(query)) return null;
    const key = query.toUpperCase();
    if (!validateIssueKey(key).valid) return null;
    try {
      const issue = await this.jiraClient.getIssue(key, { fields: ASSEMBLY_FIELDS });
      return isAssemblyIssue(issue) ? issue : null;
    } catch (err) {
      if (err?.status !== 404) {
        console.warn('[search] key lookup for', key, 'failed:', err?.status, err?.message);
      }
      return null;
    }
  }

  /** @private */
  _toAssembly(issue) {
    return toAssembly(issue, { onshapeBaseUrl: this.onshapeClient?.baseUrl });
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
   * @param {string} [payload.revision]    Revision letter, written to the Revision field
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
    if (payload.revision) {
      fields[RevisionField.REVISION] = payload.revision;
    }
    if (payload.description) {
      fields.description = payload.description;
    }
    return this.jiraClient.createIssue(fields);
  }

  /**
   * Generate a Jira epic from an Onshape assembly URL.
   *
   * The Assembly number is built entirely from the assembly's own OnShape
   * properties: Project (e.g. "VF27") + "A-" + Part number ("0000") +
   * Revision ("A") + " " + Name, giving "VF27A-0000A Test Assembly". Every
   * one of those properties must be filled in and well-formed; otherwise
   * nothing is created and a 400 lists every property that needs fixing.
   *
   * @param {string} onshapeURL
   * @returns {Promise<{ key: string, summary: string }>}
   */
  async generateEpicFromURL(onshapeURL) {
    const match = ONSHAPE_URL_REGEX.exec(onshapeURL);
    if (!match) {
      throw badRequest(
        `Invalid Onshape URL format. Expected: https://cad.onshape.com/documents/{docId}/w/{wsId}/e/{elemId}`,
      );
    }

    const [, documentId, workspaceId, elementId] = match;

    const metadata = await this.onshapeClient.getElementMetadata(
      documentId,
      workspaceId,
      elementId,
    );
    // The metadata API reports elementType as a numeric enum (1 = assembly)
    // and mimeType as e.g. "onshape/assembly" or "onshape/partstudio".
    const isAssembly =
      metadata?.mimeType === 'onshape/assembly' ||
      metadata?.elementType === 1 ||
      metadata?.elementType === 'ASSEMBLY';
    if (!isAssembly) {
      const kind = metadata?.mimeType?.replace(/^onshape\//, '') ?? 'non-assembly';
      throw badRequest(
        `The OnShape URL points to a ${kind} tab, not an assembly. Open the assembly tab and copy its URL.`,
      );
    }

    const properties = Array.isArray(metadata?.properties) ? metadata.properties : [];
    const missing = [];
    const malformed = [];
    const values = {};
    for (const { prop, pattern, hint } of REQUIRED_ASSEMBLY_PROPERTIES) {
      const value = readProperty(properties, prop);
      values[prop.name] = value;
      if (!value) missing.push(prop.name);
      else if (!pattern.test(value)) malformed.push(`${prop.name} "${value}" (expected ${hint})`);
    }

    if (missing.length || malformed.length) {
      const problems = [];
      if (missing.length) problems.push(`missing ${missing.join(', ')}`);
      if (malformed.length) problems.push(`invalid ${malformed.join('; ')}`);
      throw badRequest(
        `OnShape assembly properties are incomplete: ${problems.join('. ')}. ` +
        `Set them in the assembly's Properties dialog in OnShape and try again.`,
      );
    }

    const project = values[ONSHAPE_PROPERTY.PROJECT.name];
    const partNumber = values[ONSHAPE_PROPERTY.PART_NUMBER.name];
    const revision = values[ONSHAPE_PROPERTY.REVISION.name];
    const name = values[ONSHAPE_PROPERTY.NAME.name];
    const summary = `${project}A-${partNumber}${revision} ${name}`;

    const result = await this.createEpic({
      summary,
      revision,
      documentId,
      workspaceId,
      elementId,
    });
    return { ...result, summary };
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
      // Part mask first: it requires the revision letter, so v3 names like
      // "VF27A-0000A Intake" parse as revision A + name "Intake". Pre-v3
      // names without a letter ("VR26A-0001 Intake") fall through to the
      // title mask unchanged.
      const parsed = applyPartMask(summary) ?? applyTitleMask(summary);
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
