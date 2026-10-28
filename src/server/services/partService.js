/**
 * Part Service — manages Jira story (Part) CRUD operations with selective
 * upload, duplicate detection, and field validation.
 */

import { badRequest } from '../middleware/httpError.js';
import { applyPartMask } from '../utils/partMask.js';
import { validatePartPayload, sanitizeJQL } from '../utils/validators.js';
import { Powdercoat, Thickness, Material, Machinery } from '../utils/bomConstants.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

export class PartService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('./bomService.js').BOMService} deps.bomService
   */
  constructor({ jiraClient, bomService }) {
    this.jiraClient = jiraClient;
    this.bomService = bomService;
  }

  /**
   * Get all stories linked to an epic.
   * @param {string} epicKey
   * @returns {Promise<object[]>}
   */
  async getStoriesByEpic(epicKey) {
    const safe = sanitizeJQL(epicKey);
    const jql =
      `project = ${JIRA_PROJECT} AND issuetype = Part AND "Epic Link" = ${safe}`;
    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    return this._parseStories(issues);
  }

  /**
   * Get stories matching a part number.
   * @param {string} partNumber
   * @returns {Promise<object[]>}
   */
  async getStoriesByPartNumber(partNumber) {
    const safe = sanitizeJQL(partNumber);
    const jql =
      `project = ${JIRA_PROJECT} AND summary ~ ${safe} AND issuetype = Part`;
    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    return this._parseStories(issues);
  }

  /**
   * Get a single raw Jira issue by key. Thin passthrough that exposes the
   * previously-unrouted jiraClient.getIssue capability.
   *
   * @param {string} key  Jira issue key (e.g. "VAL-123")
   * @returns {Promise<object>}
   */
  async getStory(key) {
    /**
     * Restricted to the projects this tool owns. Without it this is an
     * unauthenticated passthrough to any issue the service-account token can
     * see, including projects unrelated to the BOM tooling — every other
     * public endpoint here goes through a project-scoped, sanitized search.
     */
    // Read at call time, not module load, so the allowlist reflects the
    // running configuration rather than whatever was set when this file was
    // first imported.
    const allowed = [
      process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? JIRA_PROJECT,
      process.env.PARTS_PROJECT_KEY ?? 'PARTS',
    ].filter(Boolean).map((p) => p.toUpperCase());

    const project = String(key ?? '').split('-')[0].toUpperCase();
    if (!allowed.includes(project)) {
      throw badRequest(
        `Issue key "${key}" is outside this tool's projects (${allowed.join(', ')}).`,
      );
    }

    return this.jiraClient.getIssue(key);
  }

  /**
   * Preview parts: fetch BOM + existing stories, categorize into
   * new / existing (with change logs) / duplicates.
   *
   * @param {object} params
   * @param {string} params.epicKey
   * @param {string} params.documentId
   * @param {string} params.workspaceId
   * @param {string} params.elementId
   * @returns {Promise<import('./types').PartPreview>}
   */
  async previewParts(params) {
    const { epicKey, documentId, workspaceId, elementId } = params;

    const [bomItems, existingStories] = await Promise.all([
      this.bomService.getBOM(epicKey, documentId, workspaceId, elementId),
      this.getStoriesByEpic(epicKey),
    ]);

    const { matched, unmatched } = this.bomService.compareBOMWithJira(
      bomItems,
      existingStories,
    );

    const duplicates = this.detectDuplicates(bomItems);

    return {
      newParts: unmatched,
      existingParts: matched,
      duplicates,
    };
  }

  /**
   * Create Jira stories only for user-selected parts.
   * Returns partial results — created parts and per-part errors.
   *
   * @param {object[]} parts  Array of part payloads to create
   * @returns {Promise<{ created: object[], errors: object[] }>}
   */
  async uploadSelected(parts) {
    const created = [];
    const errors = [];

    for (const part of parts) {
      try {
        const result = await this.createStory(part);
        created.push(result);
      } catch (err) {
        errors.push({
          fullPartNumber: part.fullPartNumber ?? part.summary,
          error: err.message,
        });
      }
    }

    return { created, errors };
  }

  /**
   * Create a Jira story (Part) with proper field formatting.
   *
   * @param {object} payload
   * @returns {Promise<{ key: string, fullPartNumber: string }>}
   */
  async createStory(payload) {
    this._validatePayload(payload);

    const fields = this._buildJiraFields(payload);
    const result = await this.jiraClient.createIssue(fields);
    return { key: result.key, fullPartNumber: payload.fullPartNumber ?? payload.summary };
  }

  /**
   * Update an existing Jira story.
   *
   * @param {string} key      Jira issue key
   * @param {object} payload  Fields to update
   * @returns {Promise<void>}
   */
  async updateStory(key, payload) {
    this._validatePayload(payload);

    const fields = {
      summary: payload.summary,
      customfield_10201: [{ value: payload.machinery }],   // Machinery
      customfield_10206: payload.quantity,                  // Quantity
      customfield_10202: { value: payload.material },       // Material
    };

    if (payload.powdercoat && payload.powdercoat !== Powdercoat.NONE) {
      fields.customfield_10204 = { value: payload.powdercoat };
    }
    if (payload.thickness && payload.thickness !== Thickness.NONE) {
      fields.customfield_10207 = { value: payload.thickness };
    }

    await this.jiraClient.updateIssue(key, fields);
  }

  /**
   * Detect duplicate part numbers in a list of BOM items.
   * Returns items grouped by fullPartNumber where count > 1.
   *
   * @param {object[]} parts
   * @returns {{ partNumber: string, occurrences: object[] }[]}
   */
  detectDuplicates(parts) {
    const groups = new Map();
    for (const part of parts) {
      const key = part.fullPartNumber;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(part);
    }

    const duplicates = [];
    for (const [partNumber, occurrences] of groups) {
      if (occurrences.length > 1) {
        duplicates.push({ partNumber, occurrences });
      }
    }
    return duplicates;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Validate payload fields against BOM constants.
   * @private
   */
  _validatePayload(payload) {
    const { valid, errors } = validatePartPayload({
      material: payload.material,
      machinery: payload.machinery,
      powdercoat: payload.powdercoat ?? Powdercoat.NONE,
      thickness: payload.thickness ?? Thickness.NONE,
      quantity: payload.quantity,
    });

    if (!valid) {
      throw new Error(`Validation failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Build Jira issue fields from a part payload.
   * Machinery → array of {value}, material/powdercoat/thickness → {value},
   * quantity → number. Omit powdercoat/thickness when "None".
   * @private
   */
  _buildJiraFields(payload) {
    const fields = {
      project: { key: JIRA_PROJECT },
      summary: payload.summary ?? payload.fullPartNumber,
      issuetype: { name: 'Part' },
      customfield_10201: [{ value: payload.machinery }],   // Machinery
      customfield_10206: payload.quantity,                  // Quantity
      customfield_10110: payload.epic,                      // Epic Link
      customfield_10202: { value: payload.material },       // Material
    };

    if (payload.powdercoat && payload.powdercoat !== Powdercoat.NONE) {
      fields.customfield_10204 = { value: payload.powdercoat };
    }
    if (payload.thickness && payload.thickness !== Thickness.NONE) {
      fields.customfield_10207 = { value: payload.thickness };
    }

    return fields;
  }

  /**
   * Parse raw Jira issues into story objects.
   * @private
   */
  _parseStories(issues) {
    const stories = [];
    for (const issue of issues) {
      const summary = issue.fields?.summary ?? '';
      const parsed = applyPartMask(summary);
      if (!parsed) continue;

      stories.push({
        ...parsed,
        key: issue.key,
        epic: issue.fields?.customfield_10110 ?? null,
        material: issue.fields?.customfield_10202?.value ?? Material.NONE,
        machinery: issue.fields?.customfield_10201?.[0]?.value ?? Machinery.NONE,
        powdercoat: issue.fields?.customfield_10204?.value ?? Powdercoat.NONE,
        quantity: issue.fields?.customfield_10206 ?? 0,
        thickness: issue.fields?.customfield_10207?.value ?? Thickness.NONE,
        project: issue.fields?.project?.key ?? JIRA_PROJECT,
      });
    }
    return stories;
  }
}
