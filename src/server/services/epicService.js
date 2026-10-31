/**
 * Epic Service — manages Jira epic (Assembly) operations with proper
 * pagination support and epic generation from Onshape URLs.
 */

import { applyTitleMask, applyPartMask } from '../utils/partMask.js';
import { sanitizeJQL, validateIssueKey } from '../utils/validators.js';
import { RevisionField, LinkType } from '../utils/buildConstants.js';
import { badRequest, conflict, HttpError } from '../middleware/httpError.js';
import { describeUpstreamError } from '../utils/upstreamError.js';
import { withKeyedLock } from '../utils/keyedLock.js';
import { stripBrackets } from '../utils/cleanName.js';
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

/** A version (/v/) or microversion (/m/) link, which can't be onboarded. */
const ONSHAPE_VERSION_URL_REGEX = /\/documents\/[a-f0-9]+\/[vm]\/[a-f0-9]+/i;

/** OnShape document, workspace and element ids are 24 hex characters. */
const ONSHAPE_ID_RE = /^[a-f0-9]{24}$/i;

/** How long a just-created Assembly is remembered for duplicate checks. */
const RECENTLY_CREATED_MS = 10 * 60 * 1000;

const INVALID_URL_MESSAGE =
  'Invalid Onshape URL format. Expected: https://cad.onshape.com/documents/{docId}/w/{wsId}/e/{elemId}';

const DRIFT_MESSAGE = 'The OnShape properties changed since you checked. Review the new name.';

const SEASON_NAMES = { R: 'Robot', F: 'Facility' };

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
   * @param {import('./buildService.js').BuildService} [deps.buildService]
   *   Only required for `onboardAssembly`, which creates Build 1.
   * @param {import('./bomService.js').BOMService} [deps.bomService]
   *   Reads the BOM to find sub-assemblies. Without it, onboarding handles
   *   only the pasted assembly.
   */
  constructor({ jiraClient, onshapeClient, buildService, bomService }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.buildService = buildService;
    this.bomService = bomService;
    /** elementId -> lock, so one sub-assembly is created once at a time. */
    this._subLocks = new Map();
    /** elementId → { assembly, at }: Assemblies this process created recently. */
    this._recentlyCreated = new Map();
    /** elementId → Promise of the running onboarding for that element. */
    this._onboarding = new Map();
  }

  /**
   * Retrieve a single epic by its full part number.
   *
   * @param {string} fullPartNumber  e.g. "VR26A-0001"
   * @returns {Promise<object|null>}
   */
  async getEpic(fullPartNumber) {
    const issue = await this._findIssueByNumber(fullPartNumber);
    return issue ? this._parseEpics([issue])[0] : null;
  }

  /**
   * The raw Assembly issue whose parsed number is exactly `fullPartNumber`.
   * A phrase search narrows the set; the exact compare happens in code.
   * @private
   */
  async _findIssueByNumber(fullPartNumber) {
    const safe = sanitizeJQL(fullPartNumber);
    const jql =
      `project = ${JIRA_PROJECT} AND issuetype = Assembly AND ` +
      `summary ~ "\\"${safe}\\""`;

    const issues = await this.jiraClient.searchIssues(jql, { paginate: true, fields: ASSEMBLY_FIELDS });
    return issues.find((issue) => {
      const summary = issue.fields?.summary ?? '';
      const parsed = applyPartMask(summary) ?? applyTitleMask(summary);
      return parsed?.fullPartNumber === fullPartNumber;
    }) ?? null;
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
   * Parse a pasted OnShape workspace link into its three ids. Runs before
   * any network call.
   *
   * @param {string} onshapeURL
   * @returns {{ documentId: string, workspaceId: string, elementId: string }}
   * @throws {HttpError} 400 for a version link or any other unusable URL
   */
  parseOnshapeUrl(onshapeURL) {
    const url = String(onshapeURL ?? '').trim();
    if (ONSHAPE_VERSION_URL_REGEX.test(url)) {
      throw badRequest('Use the link to the workspace (it has /w/ in it), not a version.');
    }
    const match = ONSHAPE_URL_REGEX.exec(url);
    if (!match) throw badRequest(INVALID_URL_MESSAGE);
    const [, documentId, workspaceId, elementId] = match;
    // The 24-character id check happens in findAssembliesForElement, before
    // the ids reach JQL.
    return {
      documentId: documentId.toLowerCase(),
      workspaceId: workspaceId.toLowerCase(),
      elementId: elementId.toLowerCase(),
    };
  }

  /**
   * Resolve a pasted OnShape URL into the Assembly it would become.
   *
   * The Assembly number is built entirely from the assembly's own OnShape
   * properties: Project (e.g. "VF27") + "A-" + Part number ("0000") +
   * Revision ("A") + " " + Name, giving "VF27A-0000A Test Assembly". Every
   * one of those properties must be filled in and well-formed; otherwise a
   * 400 lists every property that needs fixing, with `problems[]` in the body.
   *
   * @param {string} onshapeURL
   * @returns {Promise<object>} the proposed Assembly
   */
  async resolveOnshapeAssembly(onshapeURL) {
    return this._readOnshapeAssembly(this.parseOnshapeUrl(onshapeURL));
  }

  /** @private */
  async _readOnshapeAssembly({ documentId, workspaceId, elementId }, { defaultProject = null } = {}) {
    let metadata;
    try {
      metadata = await this.onshapeClient.getElementMetadata(documentId, workspaceId, elementId);
    } catch (err) {
      if (err?.status === 403 || err?.status === 404) {
        throw badRequest(
          "OnShape couldn't open that link. Check it's an assembly tab in a document shared with the team.",
        );
      }
      throw err;
    }
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
    const problems = [];
    const values = {};
    for (const { prop, pattern, hint } of REQUIRED_ASSEMBLY_PROPERTIES) {
      let value = readProperty(properties, prop);
      // A sub-assembly with no Project of its own takes its parent's, the same
      // way a BOM Part falls back to the Assembly's season.
      if (!value && prop === ONSHAPE_PROPERTY.PROJECT && defaultProject) value = defaultProject;
      values[prop.name] = value;
      if (!value) {
        missing.push(prop.name);
        problems.push({ property: prop.name, issue: 'missing', hint });
      } else if (!pattern.test(value)) {
        malformed.push(`${prop.name} "${value}" (expected ${hint})`);
        problems.push({ property: prop.name, issue: 'invalid', value, hint });
      }
    }

    if (problems.length) {
      const parts = [];
      if (missing.length) parts.push(`missing ${missing.join(', ')}`);
      if (malformed.length) parts.push(`invalid ${malformed.join('; ')}`);
      throw badRequest(
        `OnShape assembly properties are incomplete: ${parts.join('. ')}. ` +
        `Set them in the assembly's Properties dialog in OnShape and try again.`,
        { problems },
      );
    }

    const project = values[ONSHAPE_PROPERTY.PROJECT.name];
    const partNumber = values[ONSHAPE_PROPERTY.PART_NUMBER.name];
    const revision = values[ONSHAPE_PROPERTY.REVISION.name];
    const name = stripBrackets(values[ONSHAPE_PROPERTY.NAME.name]);
    const fullPartNumber = `${project}A-${partNumber}${revision}`;
    const seasonType = project[1];
    return {
      summary: `${fullPartNumber} ${name}`,
      fullPartNumber,
      name,
      project,
      partNumber,
      revision,
      seasonLabel: `${SEASON_NAMES[seasonType]} 20${project.slice(2)}`,
      documentId,
      workspaceId,
      elementId,
    };
  }

  /**
   * Assemblies already onboarded from this OnShape element, any status.
   * The JQL `~` match is only a narrowing step; the element and document
   * ids are compared exactly in code. An element id in a different
   * document is a copy, a different design, and not a duplicate.
   *
   * @param {string} documentId
   * @param {string} workspaceId
   * @param {string} elementId
   * @returns {Promise<{ assembly: object, matchedOn: 'workspace'|'document' }|null>}
   */
  async findAssembliesForElement(documentId, workspaceId, elementId) {
    if (![documentId, workspaceId, elementId].every((id) => ONSHAPE_ID_RE.test(id))) {
      throw badRequest(INVALID_URL_MESSAGE);
    }
    const matches = await this._assembliesForElement(documentId, elementId);
    if (!matches.length) return null;

    const same = (a, b) => String(a ?? '').toLowerCase() === b;
    const onWorkspace = matches.find((a) => same(a.workspaceId, workspaceId));
    return onWorkspace
      ? { assembly: onWorkspace, matchedOn: 'workspace' }
      : { assembly: matches[0], matchedOn: 'document' };
  }

  /**
   * Every Assembly made from this OnShape element in this document, newest
   * first. The JQL `~` match only narrows; ids are compared exactly here.
   * @private
   */
  async _assembliesForElement(documentId, elementId) {
    const project = sanitizeJQL(process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL');
    const jql =
      `project = ${project} AND issuetype = Assembly AND cf[10302] ~ "${sanitizeJQL(elementId)}"`;
    const issues = await this.jiraClient.searchIssues(jql, { paginate: true, fields: ASSEMBLY_FIELDS });

    const same = (a, b) => String(a ?? '').toLowerCase() === b;
    return issues
      .filter((i) => same(i.fields?.customfield_10302, elementId)
        && same(i.fields?.customfield_10300, documentId))
      .map((i) => this._toAssembly(i))
      .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
  }

  /**
   * The sub-assemblies of an Assembly, for the links on the Designer and
   * Assembly pages. The tracker stores no parent/child link, so they are read
   * from the Assembly's own OnShape BOM (a minute's cache) and each is matched
   * to the Assembly made from it: `exists` with that Assembly, or `missing`.
   *
   * A failure to read the BOM never fails the page: it comes back as `error`.
   *
   * @param {string} key  Assembly key (already validated)
   * @returns {Promise<{ subAssemblies: object[], error?: string }>}
   */
  async getSubAssemblies(key) {
    const assembly = await this.getEpicByKey(key);
    if (!assembly) throw badRequest(`"${key}" is not an Assembly`);
    if (!this.bomService || !assembly.documentId || !assembly.workspaceId || !assembly.elementId) {
      return { subAssemblies: [] };
    }

    const season = assembly.seasonType && assembly.year
      ? { seasonType: assembly.seasonType, year: assembly.year }
      : null;
    let subs;
    try {
      const report = await this.bomService.getBOMReport(
        null, assembly.documentId, assembly.workspaceId, assembly.elementId, season,
      );
      subs = report.subAssemblies ?? [];
    } catch (err) {
      return { subAssemblies: [], error: describeUpstreamError(err) };
    }

    const results = [];
    for (const sub of subs) {
      const documentId = String(sub.documentId ?? '').toLowerCase();
      const elementId = String(sub.elementId ?? '').toLowerCase();
      const base = { name: sub.name || sub.partNumber || 'Sub-assembly', partNumber: sub.partNumber, revision: sub.revision };
      if (!ONSHAPE_ID_RE.test(documentId) || !ONSHAPE_ID_RE.test(elementId)) {
        results.push({ ...base, status: 'missing' });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const matches = await this._assembliesForElement(documentId, elementId);
        const workspace = sub.wvmType === 'w' ? String(sub.wvmId ?? '').toLowerCase() : null;
        // The workspace the BOM points at, then the Revision the BOM row shows.
        let found = matches.find((a) => workspace && String(a.workspaceId ?? '').toLowerCase() === workspace)
          ?? matches.find((a) => sub.revision && a.revision === sub.revision)
          ?? matches[0];
        if (!found) {
          // Search lags a create; the recent record covers Assemblies made a moment ago.
          // eslint-disable-next-line no-await-in-loop
          const recent = await this._findExisting({
            documentId, workspaceId: workspace ?? assembly.workspaceId, elementId,
          });
          found = recent?.assembly;
        }
        results.push(found ? { ...base, status: 'exists', assembly: found } : { ...base, status: 'missing' });
      } catch (err) {
        console.warn('[sub-assemblies]', key, sub.name, 'lookup failed:', err?.status, err?.message);
        results.push({ ...base, status: 'missing' });
      }
    }
    return { subAssemblies: results };
  }

  /**
   * Read-only check of a pasted OnShape link before onboarding (design 6.5).
   *
   * @param {string} url
   * @returns {Promise<{ status: 'exists', assembly: object, matchedOn: string }
   *   | { status: 'new', proposed: object }>}
   * @throws {HttpError} 409 with `assembly` and `proposed` when the number
   *   belongs to another OnShape assembly; 400 for an unusable link
   */
  async previewOnboarding(url) {
    const ids = this.parseOnshapeUrl(url);
    const found = await this._classify(ids);

    if (found.kind === 'exists') {
      const a = found.assembly;
      const season = a.seasonType && a.year ? { seasonType: a.seasonType, year: a.year } : null;
      return {
        status: 'exists',
        assembly: a,
        matchedOn: found.matchedOn,
        ...(found.branchMismatch ? { branchMismatch: found.branchMismatch } : {}),
        ...(await this._previewSubAssemblies(ids, season)),
      };
    }
    if (found.kind === 'conflict') {
      throw conflict(
        `${found.proposed.fullPartNumber} is already used by ${found.assembly.key}.`,
        { assembly: found.assembly, proposed: found.proposed },
      );
    }

    const { proposed } = found;
    const season = { seasonType: proposed.project[1], year: proposed.project.slice(2) };
    return {
      status: found.kind === 'revision' ? 'revision' : 'new',
      proposed,
      ...(found.previous ? { previous: found.previous } : {}),
      ...(await this._previewSubAssemblies(ids, season)),
    };
  }

  /**
   * What a pasted (or sub-assembly) link is, given what the tracker already
   * holds for its OnShape element:
   *
   * - `exists`: already an Assembly (same workspace, or a branch that is the
   *   same Revision). `branchMismatch` is set when the branch carries a
   *   different number than the Assembly it came from.
   * - `revision`: a branch of an element that is already an Assembly, with the
   *   same number and a higher Revision letter. It becomes a new Assembly,
   *   linked to the earlier one (`previous`).
   * - `conflict`: its number belongs to a different OnShape assembly.
   * - `new`: not in the tracker yet.
   *
   * @private
   */
  async _classify(ids, { defaultProject = null } = {}) {
    const found = await this._findExisting(ids);

    if (found && found.matchedOn !== 'document') return { kind: 'exists', ...found };

    if (found) {
      // Another branch of an element already onboarded. Its own properties
      // say whether it is a new Revision.
      let proposed;
      try {
        proposed = await this._readOnshapeAssembly(ids, { defaultProject });
      } catch (err) {
        if (err?.status === 400) return { kind: 'exists', ...found };
        throw err;
      }
      const previous = found.assembly;
      const sameNumber = previous.seasonCode === proposed.project && previous.partNumber === proposed.partNumber;
      if (!sameNumber) return { kind: 'exists', ...found, branchMismatch: { proposed } };

      if (proposed.revision > (previous.revision || 'A')) {
        // Revision B may already exist for another branch of the element.
        const taken = await this._findIssueByNumber(proposed.fullPartNumber);
        if (taken) return { kind: 'exists', assembly: this._toAssembly(taken), matchedOn: 'document' };
        return { kind: 'revision', proposed, previous };
      }
      return { kind: 'exists', ...found };
    }

    const proposed = await this._readOnshapeAssembly(ids, { defaultProject });
    const clash = await this._findIssueByNumber(proposed.fullPartNumber);
    if (clash) return { kind: 'conflict', proposed, assembly: this._toAssembly(clash) };
    return { kind: 'new', proposed };
  }

  // ---------------------------------------------------------------------------
  // Sub-assemblies
  // ---------------------------------------------------------------------------

  /**
   * The sub-assemblies listed in an assembly's BOM.
   * @private
   */
  async _listSubAssemblies({ documentId, workspaceId, elementId }, season) {
    if (!this.bomService) return [];
    const report = await this.bomService.getBOMReport(
      null, documentId, workspaceId, elementId, season, { fresh: true },
    );
    return report.subAssemblies ?? [];
  }

  /**
   * The workspace to store for a sub-assembly: the one the BOM names when it
   * points at a workspace, otherwise the document's Main workspace (a
   * sub-assembly can be referenced by version from another document).
   * @private
   */
  async _workspaceFor(sub, documentId, cache) {
    if (sub.wvmType === 'w' && ONSHAPE_ID_RE.test(String(sub.wvmId ?? ''))) {
      return String(sub.wvmId).toLowerCase();
    }
    if (!cache.has(documentId)) {
      const list = await this.onshapeClient.getWorkspaces(documentId);
      const workspaces = Array.isArray(list) ? list : [];
      const main = workspaces.find((w) => w.name === 'Main') ?? workspaces[0];
      cache.set(documentId, main?.id ? String(main.id).toLowerCase() : null);
    }
    return cache.get(documentId);
  }

  /**
   * What would happen to one sub-assembly, without writing anything:
   * `exists` (already an Assembly), `new`, `conflict` (its number belongs to a
   * different OnShape assembly), `problems` (its properties are incomplete) or
   * `error` (could not check).
   * @private
   */
  async _checkSubAssembly(sub, cache, defaultProject = null) {
    const name = stripBrackets(sub.name) || sub.partNumber || 'Sub-assembly';
    const documentId = String(sub.documentId ?? '').toLowerCase();
    const elementId = String(sub.elementId ?? '').toLowerCase();
    if (!ONSHAPE_ID_RE.test(documentId) || !ONSHAPE_ID_RE.test(elementId)) {
      return { name, status: 'error', message: 'OnShape did not say where this sub-assembly lives.' };
    }
    try {
      const workspaceId = await this._workspaceFor(sub, documentId, cache);
      if (!workspaceId) {
        return { name, status: 'error', message: 'Could not find the document workspace.' };
      }
      const ids = { documentId, workspaceId, elementId };

      const c = await this._classify(ids, { defaultProject });
      if (c.kind === 'exists') return { name, status: 'exists', assembly: c.assembly, ids };
      if (c.kind === 'conflict') {
        return { name, status: 'conflict', proposed: c.proposed, assembly: c.assembly, ids };
      }
      if (c.kind === 'revision') {
        return { name: c.proposed.name, status: 'revision', proposed: c.proposed, previous: c.previous, ids };
      }
      return { name: c.proposed.name, status: 'new', proposed: c.proposed, ids };
    } catch (err) {
      if (err?.status === 400) {
        return { name, status: 'problems', problems: err.details?.problems ?? [], message: err.message };
      }
      return { name, status: 'error', message: describeUpstreamError(err) };
    }
  }

  /** A check result without server-only fields, for the client. @private */
  _publicSub({ ids, ...rest }) {
    return rest;
  }

  /**
   * Read-only: the sub-assemblies of a pasted assembly and what each would
   * do. A failure here never blocks the main onboarding; it is reported
   * instead.
   * @private
   */
  async _previewSubAssemblies(ids, season) {
    let subs;
    try {
      subs = await this._listSubAssemblies(ids, season);
    } catch (err) {
      return { subAssemblies: [], subAssembliesError: describeUpstreamError(err) };
    }
    const cache = new Map();
    const defaultProject = season ? `V${season.seasonType}${season.year}` : null;
    const checked = [];
    for (const sub of subs) {
      // eslint-disable-next-line no-await-in-loop
      checked.push(this._publicSub(await this._checkSubAssembly(sub, cache, defaultProject)));
    }
    return { subAssemblies: checked };
  }

  /**
   * Create each missing sub-assembly (with its Build 1) and report every
   * one: created, already existing, skipped or failed. Nothing that exists is
   * created again.
   * @private
   */
  async _ensureSubAssemblies(ids, season) {
    let subs;
    try {
      subs = await this._listSubAssemblies(ids, season);
    } catch (err) {
      return { subAssemblies: [], subAssembliesError: describeUpstreamError(err) };
    }
    const cache = new Map();
    const defaultProject = season ? `V${season.seasonType}${season.year}` : null;
    const results = [];
    for (const sub of subs) {
      // eslint-disable-next-line no-await-in-loop
      const checked = await this._checkSubAssembly(sub, cache, defaultProject);
      if (checked.status !== 'new' && checked.status !== 'revision') {
        results.push(this._publicSub(checked));
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await withKeyedLock(this._subLocks, checked.ids.elementId, async () => {
          // Another request may have created it while this one waited.
          const again = await this._classify(checked.ids, { defaultProject });
          if (again.kind === 'exists') return { status: 'exists', assembly: again.assembly };
          if (again.kind === 'conflict') return { status: 'conflict', proposed: again.proposed, assembly: again.assembly };
          const made = await this._createAssemblyWithBuild(again.proposed, again.previous ?? null);
          return { status: 'created', ...made };
        });
        results.push({ name: checked.name, ...outcome });
      } catch (err) {
        console.warn('[onboard] sub-assembly', checked.proposed.fullPartNumber, 'failed:', err?.status, err?.message);
        results.push({ name: checked.name, status: 'error', message: describeUpstreamError(err) });
      }
    }
    return { subAssemblies: results };
  }

  /**
   * Duplicate check: the tracker first, then this process's record of
   * Assemblies it created in the last 10 minutes (covers search lag).
   * @private
   */
  async _findExisting({ documentId, workspaceId, elementId }) {
    const found = await this.findAssembliesForElement(documentId, workspaceId, elementId);
    if (found) return found;

    const recent = this._recentlyCreated.get(elementId);
    if (!recent) return null;
    if (Date.now() - recent.at > RECENTLY_CREATED_MS) {
      this._recentlyCreated.delete(elementId);
      return null;
    }
    if (recent.documentId !== documentId) return null;
    // A failed read propagates: answering "new" here would risk a duplicate.
    const issue = await this.jiraClient.getIssue(recent.key, { fields: ASSEMBLY_FIELDS });
    return {
      assembly: this._toAssembly(issue),
      matchedOn: !recent.workspaceId || recent.workspaceId === workspaceId ? 'workspace' : 'document',
    };
  }

  /**
   * Create the Assembly and its Build 1 from a confirmed OnShape link
   * (design 6.6). One onboarding runs per OnShape element at a time; a
   * second caller waits for the first and answers from its result.
   *
   * @param {object} params
   * @param {string} params.url
   * @param {string} params.expectedSummary  The summary the user confirmed
   * @returns {Promise<{ status: 'created'|'exists', assembly: object,
   *   build: object|null, buildError?: string|null }>}
   */
  async onboardAssembly({ url, expectedSummary }) {
    if (!this.buildService) {
      throw new Error('onboardAssembly requires a buildService dependency');
    }
    const ids = this.parseOnshapeUrl(url);

    const running = this._onboarding.get(ids.elementId);
    if (running) {
      let first;
      try {
        first = await running;
      } catch {
        // The first call failed; run the whole sequence for this caller.
        if (this._onboarding.get(ids.elementId) === running) this._onboarding.delete(ids.elementId);
        return this.onboardAssembly({ url, expectedSummary });
      }
      if (first.response.assembly.summary !== expectedSummary) {
        throw conflict(DRIFT_MESSAGE, { proposed: first.proposed ?? null });
      }
      return { status: 'exists', assembly: first.response.assembly, build: first.response.build ?? null };
    }

    const promise = this._onboardOnce(ids, expectedSummary);
    this._onboarding.set(ids.elementId, promise);
    try {
      return (await promise).response;
    } finally {
      this._onboarding.delete(ids.elementId);
    }
  }

  /** @private */
  async _onboardOnce(ids, expectedSummary) {
    const found = await this._classify(ids);
    if (found.kind === 'exists') {
      // The caller asked explicitly, so a sub-assembly added since is created too.
      const a = found.assembly;
      const season = a.seasonType && a.year ? { seasonType: a.seasonType, year: a.year } : null;
      const subs = await this._ensureSubAssemblies(ids, season);
      return { response: { status: 'exists', assembly: found.assembly, build: null, ...subs }, proposed: null };
    }
    if (found.kind === 'conflict') {
      throw conflict(`${found.proposed.fullPartNumber} is already used by ${found.assembly.key}.`, { assembly: found.assembly });
    }

    const { proposed } = found;
    if (proposed.summary !== expectedSummary) {
      throw conflict(DRIFT_MESSAGE, { proposed, ...(found.previous ? { previous: found.previous } : {}) });
    }

    const made = await this._createAssemblyWithBuild(proposed, found.previous ?? null);
    const season = { seasonType: proposed.project[1], year: proposed.project.slice(2) };
    const subs = await this._ensureSubAssemblies(ids, season);
    return { response: { status: 'created', ...made, ...subs }, proposed };
  }

  /**
   * Create an Assembly and its Build 1 from a validated proposal. Build 1
   * failing leaves the Assembly in place and is reported, not thrown.
   * @private
   */
  async _createAssemblyWithBuild(proposed, previous = null) {
    const { key } = await this.createEpic({
      summary: proposed.summary,
      revision: proposed.revision,
      documentId: proposed.documentId,
      workspaceId: proposed.workspaceId,
      elementId: proposed.elementId,
    });

    // Built from what was just written, without a read that could fail or lag.
    const assembly = this._toAssembly({
      key,
      fields: {
        summary: proposed.summary,
        issuetype: { name: 'Assembly' },
        [RevisionField.REVISION]: proposed.revision,
        customfield_10300: proposed.documentId,
        customfield_10301: proposed.workspaceId,
        customfield_10302: proposed.elementId,
        status: { name: 'New' },
        created: new Date().toISOString(),
      },
    });
    this._recentlyCreated.set(proposed.elementId, {
      key, documentId: proposed.documentId, workspaceId: proposed.workspaceId, at: Date.now(),
    });

    // A new Revision is chained to the one it replaces, so Parts and Builds of
    // the earlier Revision stay reachable from this one.
    let revisionLinkError = null;
    if (previous) {
      try {
        await this.jiraClient.createIssueLink(LinkType.REVISES, key, previous.key);
      } catch (err) {
        console.warn('[onboard] Revises link', key, '->', previous.key, 'failed:', err?.status, err?.message);
        revisionLinkError = describeUpstreamError(err);
      }
    }

    let build = null;
    let buildError = null;
    try {
      build = await this.buildService.createBuild({
        assemblyKey: key,
        revisionChainKeys: [key],
        name: proposed.name,
      });
    } catch (err) {
      console.warn('[onboard] Build 1 for', key, 'failed:', err?.status, err?.message);
      buildError = describeUpstreamError(err);
    }

    return {
      assembly,
      build,
      buildError,
      ...(previous ? { revisionOf: previous, revisionLinkError } : {}),
    };
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
