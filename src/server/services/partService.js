/**
 * Part Service — manages Jira story (Part) CRUD operations with selective
 * upload, duplicate detection, and field validation.
 */

import { badRequest, HttpError } from '../middleware/httpError.js';
import { applyPartMask, applyTitleMask, formatPartNumber } from '../utils/partMask.js';
import { validatePartPayload, sanitizeJQL } from '../utils/validators.js';
import { Powdercoat, Thickness, Material, Machinery } from '../utils/bomConstants.js';
import { RevisionField } from '../utils/buildConstants.js';
import { preferNewestRevision } from '../utils/partChain.js';
import { withKeyedLock } from '../utils/keyedLock.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

/** Most Revision tickets one Epic Link query may list. */
const MAX_CHAIN_KEYS = 50;

/**
 * A Part in the `_parseStories` shape, built from the fields just written
 * instead of a read (search lags a create). Maps each field exactly as
 * `_parseStories` maps a fetched one, plus `revision`.
 *
 * @param {string} key
 * @param {string} summary
 * @param {object} fields  The Jira fields that were written
 * @returns {object}
 */
export function partFromWritten(key, summary, fields = {}) {
  return {
    ...applyPartMask(summary ?? ''),
    key,
    epic: fields.customfield_10110 ?? null,
    material: fields.customfield_10202?.value ?? Material.NONE,
    machinery: fields.customfield_10201?.[0]?.value ?? Machinery.NONE,
    powdercoat: fields.customfield_10204?.value ?? Powdercoat.NONE,
    quantity: fields.customfield_10206 ?? 0,
    thickness: fields.customfield_10207?.value ?? Thickness.NONE,
    project: fields.project?.key ?? JIRA_PROJECT,
    revision: fields[RevisionField.REVISION] ?? null,
  };
}

export class PartService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('./bomService.js').BOMService} deps.bomService
   * @param {import('./revisionService.js').RevisionService} [deps.revisionService]
   *   Used to scope Part reads to an Assembly's Revision chain. Without it
   *   the chain is just the key itself.
   */
  constructor({ jiraClient, bomService, revisionService }) {
    this.jiraClient = jiraClient;
    this.bomService = bomService;
    this.revisionService = revisionService;
    /** Highest Part number this process created, per season ("VF27" -> 7). */
    this._allocFloor = new Map();
    /** Per-season lock so concurrent Clones allocate different numbers. */
    this._allocLock = new Map();
  }

  /**
   * Parts whose Epic Link is any of the given tickets (an Assembly's
   * Revision chain).
   *
   * @param {string[]} keys  At most 50
   * @returns {Promise<object[]>}
   */
  async getStoriesByEpics(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    if (keys.length > MAX_CHAIN_KEYS) {
      throw new HttpError(500, `A Revision chain of ${keys.length} tickets is more than ${MAX_CHAIN_KEYS}`);
    }
    const safeKeys = keys.map((k) => sanitizeJQL(k)).join(', ');
    const jql =
      `project = ${JIRA_PROJECT} AND issuetype = Part AND "Epic Link" in (${safeKeys})`;
    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    return this._parseStories(issues);
  }

  /**
   * Parts of an Assembly across its whole Revision chain, one per Part
   * number (the newest Revision's copy wins). The key is checked by key
   * first, so a Part key never reaches the Epic Link query.
   *
   * @param {string} key  An Assembly (or Assembly Revision) key
   * @returns {Promise<{ chain: string[], stories: object[] }>}
   */
  async getStoriesForChain(key) {
    let issue;
    try {
      issue = await this.jiraClient.getIssue(key, { fields: ['issuetype'] });
    } catch (err) {
      if (err?.status === 404) throw new HttpError(404, `No Assembly ${key} found`);
      throw err;
    }
    const type = issue?.fields?.issuetype?.name;
    if (type !== 'Epic' && type !== 'Assembly') {
      throw badRequest(`"${key}" is not an Assembly`);
    }

    const chain = this.revisionService
      ? await this.revisionService.getRevisionChain(key)
      : [key];
    const stories = preferNewestRevision(await this.getStoriesByEpics(chain), chain);
    return { chain, stories };
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
   * Get parsed Part stories for an explicit set of keys — the bulk fetch the
   * Assembly hub needs to render a per-build BOM (Sheet 06), since
   * BuildService only knows the linked part *keys*, not their fields.
   *
   * @param {string[]} keys
   * @returns {Promise<object[]>}
   */
  async getStoriesByKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return [];

    const safeKeys = keys.map((k) => sanitizeJQL(k)).join(', ');
    const jql = `project = ${JIRA_PROJECT} AND issuetype = Part AND key in (${safeKeys})`;
    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    return this._parseStories(issues);
  }

  /**
   * The next unused Part number for a season — one past whatever the
   * highest existing `V{seasonType}{year}P-NNNN` number is. ValorBOM has
   * never allocated its own Part numbers before (every one up to now came
   * from Onshape's own BOM export); this is only for "Clone a part" (Sheet
   * 06), where a fresh ticket never touches CAD at all.
   *
   * Numbers are flat across the whole season, not scoped per Assembly — the
   * number itself carries no Assembly identity, only "Epic Link" does.
   *
   * @param {string} seasonType  "R" or "F"
   * @param {string} year        Two-digit year string
   * @returns {Promise<string>} Four-digit, zero-padded
   */
  async getNextPartNumber(seasonType, year) {
    const safeSeasonType = sanitizeJQL(seasonType);
    const safeYear = sanitizeJQL(year);
    const jql =
      `project = ${JIRA_PROJECT} AND issuetype = Part AND summary ~ "V${safeSeasonType}${safeYear}P-*"`;

    const issues = await this.jiraClient.searchIssues(jql, { paginate: true, fields: ['summary'] });
    const stories = this._parseStories(issues);
    const searchMax = stories.reduce((acc, s) => Math.max(acc, parseInt(s.partNumber, 10) || 0), 0);
    // Search lags a create, so a number this process just wrote counts too.
    const floor = this._allocFloor.get(`V${seasonType}${year}`) ?? 0;
    return String(Math.max(searchMax, floor) + 1).padStart(4, '0');
  }

  /**
   * "Clone a part" (Sheet 06): duplicate an existing Part's BOM fields into
   * a brand-new, unrelated ticket with a self-allocated number — for
   * something the assembly side needs that never touched CAD (a spare, a
   * second copy of a fastener plate). Unlike Re-create, this isn't a
   * revision of anything and isn't linked to any Build.
   *
   * @param {object} params
   * @param {string} params.sourceKey  The Part being duplicated
   * @param {string} params.epicKey    The Assembly the new ticket belongs to
   * @param {string} [params.name]     Defaults to the source Part's own name
   * @param {number} [params.quantity] Defaults to the source Part's quantity
   * @returns {Promise<{ key: string, fullPartNumber: string, part: object }>}
   */
  async clonePart({ sourceKey, epicKey, name, quantity }) {
    const [source] = await this.getStoriesByKeys([sourceKey]);
    if (!source) {
      throw badRequest(`"${sourceKey}" is not a Part`);
    }

    // Allocation and create run one at a time per season, so two Clones
    // inside the search lag window can't take the same number.
    const season = `V${source.seasonType}${source.year}`;
    return withKeyedLock(this._allocLock, season, async () => {
      const nextNumber = await this.getNextPartNumber(source.seasonType, source.year);
      const summary = formatPartNumber({
        seasonType: source.seasonType,
        year: source.year,
        isEpic: false,
        partNumber: nextNumber,
        version: 'A',
        name: name ?? source.name,
      });

      const { key, fields } = await this._createPart({
        summary,
        epic: epicKey,
        quantity: quantity ?? source.quantity,
        material: source.material,
        machinery: source.machinery,
        powdercoat: source.powdercoat,
        thickness: source.thickness,
      });
      const part = partFromWritten(key, summary, fields);
      return { key, fullPartNumber: part.fullPartNumber, part };
    });
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
   * @param {boolean} [params.fresh]  Skip the 60-second BOM cache
   * @returns {Promise<import('./types').PartPreview>}
   */
  async previewParts(params) {
    const { epicKey, documentId, workspaceId, elementId, fresh = false } = params;

    // The Assembly's season ("VF27A-0000A ..." → F/27) is the prefix for BOM
    // rows that only carry a bare 4-digit Part number and no Project.
    // Existing Parts are read across the whole Revision chain, so a CAD row
    // whose number belongs to a Revision A Part counts as existing.
    const [{ parts: bomItems, unidentified }, { stories: existingStories }] = await Promise.all([
      this._getAssemblySeason(epicKey).then((assembly) =>
        this.bomService.getBOMReport(
          epicKey, documentId, workspaceId, elementId, assembly, { fresh: fresh === true },
        )),
      this.getStoriesForChain(epicKey),
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
      unidentified,
    };
  }

  /**
   * Season of an Assembly, parsed from its Jira summary the same way
   * EpicService._parseEpics does. Null when the summary has no
   * V{R|F}{yy}A- prefix.
   *
   * @param {string} epicKey
   * @returns {Promise<{ seasonType: string, year: string } | null>}
   * @private
   */
  async _getAssemblySeason(epicKey) {
    // A failed lookup must not sink the whole preview: rows that carry their
    // own Project still identify, and the rest come back unidentified with
    // the existing "missing Project" message.
    let issue;
    try {
      issue = await this.jiraClient.getIssue(epicKey, { fields: ['summary'] });
    } catch (err) {
      console.warn('[preview] season lookup for', epicKey, 'failed:', err.status, err.message);
      return null;
    }
    const summary = issue?.fields?.summary ?? '';
    const parsed = applyPartMask(summary) ?? applyTitleMask(summary);
    return parsed ? { seasonType: parsed.seasonType, year: parsed.year } : null;
  }

  /**
   * Create a Jira story (Part) with proper field formatting.
   *
   * @param {object} payload
   * @returns {Promise<{ key: string, fullPartNumber: string }>}
   */
  async createStory(payload) {
    const { key } = await this._createPart(payload);
    return { key, fullPartNumber: payload.fullPartNumber ?? payload.summary };
  }

  /**
   * Validate, write and record one Part. Every Part create passes through
   * here, so a number written by a Save raises the Clone floor too.
   *
   * @returns {Promise<{ key: string, fields: object }>}
   * @private
   */
  async _createPart(payload) {
    this._validatePayload(payload);

    const fields = this._buildJiraFields(payload);
    const result = await this.jiraClient.createIssue(fields);
    this._raiseAllocFloor(fields.summary);
    return { key: result.key, fields };
  }

  /** @private */
  _raiseAllocFloor(summary) {
    const parsed = applyPartMask(summary ?? '');
    if (!parsed || parsed.isEpic) return;
    const season = `V${parsed.seasonType}${parsed.year}`;
    const number = parseInt(parsed.partNumber, 10);
    this._allocFloor.set(season, Math.max(this._allocFloor.get(season) ?? 0, number));
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

    // Jira clears a single-select with null; omitting it would keep the old
    // value while the row reports "Saved".
    if (payload.powdercoat === Powdercoat.NONE) {
      fields.customfield_10204 = null;
    } else if (payload.powdercoat) {
      fields.customfield_10204 = { value: payload.powdercoat };
    }
    if (payload.thickness === Thickness.NONE) {
      fields.customfield_10207 = null;
    } else if (payload.thickness) {
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
      throw badRequest(`Validation failed: ${errors.join('; ')}`);
    }

    if (payload.revision !== undefined && payload.revision !== null
      && !(typeof payload.revision === 'string' && /^[A-Z]$/.test(payload.revision))) {
      throw badRequest('Validation failed: revision must be a single capital letter (A-Z)');
    }
  }

  /**
   * Build Jira issue fields from a part payload.
   * Machinery → array of {value}, material/powdercoat/thickness → {value},
   * quantity → number. Omit powdercoat/thickness when "None".
   * Revision comes from the payload, else the summary's letter, else "A".
   * @private
   */
  _buildJiraFields(payload) {
    const summary = payload.summary ?? payload.fullPartNumber;
    const revision = payload.revision ?? applyPartMask(summary ?? '')?.version ?? 'A';
    const fields = {
      project: { key: JIRA_PROJECT },
      summary,
      issuetype: { name: 'Part' },
      customfield_10201: [{ value: payload.machinery }],   // Machinery
      customfield_10206: payload.quantity,                  // Quantity
      customfield_10110: payload.epic,                      // Epic Link
      customfield_10202: { value: payload.material },       // Material
      [RevisionField.REVISION]: revision,                   // Revision
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
