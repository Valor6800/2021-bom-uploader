/**
 * Build Service — manages Build issues: creation, continuous numbering
 * across an Assembly's revision chain, the Part <-> Build "Used In" link,
 * and driving Build's own workflow (Draft -> Active -> Superseded, plus
 * Archive) so nobody has to flip a status by hand.
 */

import {
  sanitizeJQL, validateMaterial, validateMachinery, validatePowdercoat, validateQuantity, validatePriority,
} from '../utils/validators.js';
import {
  BuildField, BuildStatus, BuildTransition, LinkType, usedInLinkedClause,
} from '../utils/buildConstants.js';
import { applyPartMask, formatPartNumber } from '../utils/partMask.js';
import { Powdercoat } from '../utils/bomConstants.js';
import { badRequest, conflict, HttpError } from '../middleware/httpError.js';
import { describeUpstreamError, jiraErrorsForLog, upstreamSource } from '../utils/upstreamError.js';
import { baseNumber, preferNewestRevision } from '../utils/partChain.js';
import { withKeyedLock } from '../utils/keyedLock.js';
import { blockOf } from './partNumbers.js';
import { missingFiles } from '../utils/partFileCheck.js';
import {
  buildLabelOf, cutBuildConflict, cutBuildsAmong, isCutStatus, sharedPartConflict, usedInKeys,
} from '../utils/cutBuilds.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

/** Parallel by-key reads are sent in batches of this size. */
const READ_BATCH = 10;

const ONSHAPE_ID_RE = /^[a-f0-9]{24}$/i;

/** Per-item field checks for a save, in the order they are reported. */
const FIELD_CHECKS = [
  ['material', 'Material', validateMaterial],
  ['machinery', 'Machinery', validateMachinery],
  ['powdercoat', 'Powdercoat', validatePowdercoat],
];

/** Read `fn(item)` for each item, at most READ_BATCH at a time. */
async function inBatches(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += READ_BATCH) {
    out.push(...await Promise.all(items.slice(i, i + READ_BATCH).map(fn)));
  }
  return out;
}

/** `getIssue`, answering null for a 404. */
async function getIssueOrNull(jiraClient, key, fields) {
  try {
    return await jiraClient.getIssue(key, { fields });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** Add keys to an upstream error's details, keeping its status and class. */
function withDetails(err, details) {
  if (err && typeof err === 'object') err.details = { ...err.details, ...details };
  return err;
}

/** True when a Part's issuelinks already hold a "Used In" link to the Build (either side). */
function hasUsedInLink(issuelinks, buildKey) {
  return (issuelinks ?? []).some((link) => link?.type?.name === LinkType.USED_IN
    && (link.outwardIssue?.key === buildKey || link.inwardIssue?.key === buildKey));
}

/**
 * The BOM values a save writes, with None for an absent Powdercoat.
 * Priority is included only when the item carries one. Needs Tapping? and
 * Thickness are never saved: the tool sets them when the Build is cut
 * (PartFiles), so a save leaves them as they are.
 */
function bomValues(item) {
  return {
    quantity: item.quantity,
    material: item.material,
    machinery: item.machinery,
    powdercoat: item.powdercoat ?? Powdercoat.NONE,
    ...(item.priority !== undefined && item.priority !== null ? { priority: item.priority } : {}),
  };
}

/**
 * The first field of a save item that fails its check, as
 * `{ field, error }`, or null.
 */
function fieldProblem(item) {
  const values = bomValues(item);
  for (const [field, label, check] of FIELD_CHECKS) {
    if (!check(values[field]).valid) {
      return { field, error: `${label} "${values[field]}" isn't on the list. Pick one.` };
    }
  }
  if (!validateQuantity(values.quantity).valid) {
    return { field: 'quantity', error: 'Quantity must be a whole number of 1 or more.' };
  }
  if (!validatePriority(values.priority).valid) {
    return { field: 'priority', error: `Priority "${values.priority}" isn't on the list. Pick one.` };
  }
  return null;
}

export class BuildService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('../clients/onshapeClient.js').OnshapeClient} [deps.onshapeClient]
   *   Only required for `cutVersionFromOnshape`; `cutVersion` itself is pure
   *   Jira and doesn't need it.
   * @param {import('./revisionService.js').RevisionService} [deps.revisionService]
   *   Required for `saveBuildParts`.
   * @param {import('./partService.js').PartService} [deps.partService]
   *   Required for `saveBuildParts`.
   * @param {import('./partNumbers.js').PartNumbers} [deps.partNumbers]
   *   Numbers new Parts on Save.
   * @param {import('./onshapeWriter.js').OnshapeWriter} [deps.onshapeWriter]
   *   Writes numbers and Revisions back into OnShape (Save and Cut Version).
   * @param {import('./fileJobs.js').FileJobs} [deps.fileJobs]
   *   Attaches each new Part's picture, STEP and DXF in the background (Save).
   * @param {import('./pictures.js').Pictures} [deps.pictures]
   *   Attaches the Assembly's picture to a Build when it is cut.
   */
  constructor({
    jiraClient, onshapeClient, revisionService, partService, partNumbers, onshapeWriter, fileJobs, pictures,
  }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.revisionService = revisionService;
    this.partService = partService;
    this.partNumbers = partNumbers;
    this.onshapeWriter = onshapeWriter;
    this.fileJobs = fileJobs;
    this.pictures = pictures;
    /** In-flight Cut Versions by Build key. */
    this._cutting = new Map();
  }

  /**
   * Build statuses read by key (search lags a status change).
   *
   * @param {string[]} keys
   * @returns {Promise<{ builds: { key: string, status: string|null,
   *   assemblyKey: string|null, onshapeVersionLink: string|null }[], missing: string[] }>}
   */
  async getBuildStatuses(keys) {
    const issues = await Promise.all(keys.map((key) => getIssueOrNull(
      this.jiraClient, key,
      ['issuetype', 'status', BuildField.ASSEMBLY_LINK, BuildField.ONSHAPE_VERSION_LINK],
    )));

    const builds = [];
    const missing = [];
    keys.forEach((key, index) => {
      const fields = issues[index]?.fields;
      if (fields?.issuetype?.name !== 'Build') {
        missing.push(key);
        return;
      }
      builds.push({
        key,
        status: fields.status?.name ?? null,
        assemblyKey: fields[BuildField.ASSEMBLY_LINK] ?? null,
        onshapeVersionLink: fields[BuildField.ONSHAPE_VERSION_LINK] ?? null,
      });
    });
    return { builds, missing };
  }

  /**
   * All Builds linked to any of the given Assembly keys, newest first.
   *
   * Pass every ticket in an Assembly's revision chain (Sheet 01/02 of the
   * plan) to see the full build history across revisions; pass a single key
   * to scope to just that one ticket's own Builds.
   *
   * @param {string[]} assemblyKeys
   * @returns {Promise<object[]>}
   */
  async getBuildsForAssemblies(assemblyKeys) {
    if (!Array.isArray(assemblyKeys) || assemblyKeys.length === 0) return [];

    const safeKeys = assemblyKeys.map((k) => sanitizeJQL(k)).join(', ');
    const jql =
      `project = ${JIRA_PROJECT} AND issuetype = Build AND "Epic Link" in (${safeKeys}) ` +
      'ORDER BY "Build Number" DESC';

    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    return this._parseBuilds(issues);
  }

  /**
   * The Build Number the next Build should get: one past the highest among
   * the given tickets' Builds. Numbers count per Revision ticket, so a new
   * Revision starts again at Build 1 (the caller passes just that ticket).
   *
   * @param {string[]} assemblyKeys  The Assembly (Revision) ticket(s) to count
   * @returns {Promise<number>}
   */
  async getNextBuildNumber(assemblyKeys) {
    const builds = await this.getBuildsForAssemblies(assemblyKeys);
    const max = builds.reduce((acc, b) => Math.max(acc, b.buildNumber ?? 0), 0);
    return max + 1;
  }

  /**
   * Create a Build issue under a specific Assembly (or Assembly Revision)
   * ticket. Build Number is assigned here, not left for the caller to guess,
   * so two students creating a Build at the same moment can't collide —
   * callers still carry the usual read-then-write race since this isn't
   * transactional, but at least the number itself is never hand-typed.
   *
   * The revision chain is derived here (when revisionService is injected)
   * and unioned with any keys the caller sent. It only scopes `cloneFromBuildKey`
   * (a Build of an earlier Revision may be copied); the number counts this
   * Assembly's own Builds.
   *
   * `cloneFromBuildKey` is only validated here, before anything is created:
   * it must be a Build of this Assembly's chain. Copying its Parts is the
   * caller's next step (`cloneBuildParts`).
   *
   * @param {object} params
   * @param {string} params.assemblyKey        The immediate parent ticket
   * @param {string[]} [params.revisionChainKeys]  Extra chain keys from the caller
   * @param {string} params.name                Human name, e.g. "Intake"
   * @param {string} [params.description]       Optional, appended as " - …"
   * @param {string} [params.cloneFromBuildKey] Source Build to validate
   * @returns {Promise<{ key: string, summary: string, assemblyKey: string,
   *   buildNumber: number, status: string, onshapeVersionLink: null }>}
   */
  async createBuild({ assemblyKey, revisionChainKeys, name, description, cloneFromBuildKey }) {
    const chainKeys = await this._chainFor(assemblyKey, revisionChainKeys);

    if (cloneFromBuildKey) {
      await this._checkCloneSource(cloneFromBuildKey, chainKeys);
    }

    // Per Revision: Revision B's first Build is Build 1, whatever Revision A has.
    const buildNumber = await this.getNextBuildNumber([assemblyKey]);
    const note = typeof description === 'string' ? description.trim() : '';
    const summary = note
      ? `${name} Build ${buildNumber} - ${note}`
      : `${name} Build ${buildNumber}`;

    const fields = {
      project: { key: JIRA_PROJECT },
      issuetype: { name: 'Build' },
      summary,
      [BuildField.ASSEMBLY_LINK]: assemblyKey,
      [BuildField.BUILD_NUMBER]: buildNumber,
    };

    const result = await this.jiraClient.createIssue(fields);
    return {
      key: result.key,
      summary,
      assemblyKey,
      buildNumber,
      status: BuildStatus.DRAFT,
      onshapeVersionLink: null,
    };
  }

  /**
   * The Assembly's revision chain: the server-side chain (when
   * revisionService is available) unioned with the caller's keys.
   * @private
   */
  async _chainFor(assemblyKey, revisionChainKeys) {
    const derived = this.revisionService
      ? await this.revisionService.getRevisionChain(assemblyKey)
      : [assemblyKey];
    return [...new Set([assemblyKey, ...derived, ...(revisionChainKeys ?? [])])];
  }

  /**
   * A clone source must be a Build whose Assembly is in this chain, so a
   * crafted request can't copy another Assembly's Parts.
   * @private
   */
  async _checkCloneSource(cloneFromBuildKey, chainKeys) {
    const refused = badRequest(`"${cloneFromBuildKey}" isn't a Build of this Assembly`);
    let source;
    try {
      source = await this.jiraClient.getIssue(cloneFromBuildKey, {
        fields: ['issuetype', BuildField.ASSEMBLY_LINK],
      });
    } catch (err) {
      if (err?.status === 404) throw refused;
      throw err;
    }
    const isBuild = source?.fields?.issuetype?.name === 'Build';
    const epic = source?.fields?.[BuildField.ASSEMBLY_LINK];
    if (!isBuild || !chainKeys.includes(epic)) throw refused;
  }

  /**
   * Link a Part into a Build — the "Used In" relationship (Sheet 02),
   * many-to-many so the same Part can be reused across sibling Builds.
   *
   * @param {string} partKey
   * @param {string} buildKey
   * @returns {Promise<void>}
   */
  async linkPartToBuild(partKey, buildKey) {
    await this._requireDraftBuild(buildKey);
    await this._link(partKey, buildKey);
  }

  /**
   * The Used In write itself, for callers that already checked the Build
   * is a Draft in this request.
   * @private
   */
  async _link(partKey, buildKey) {
    // "Build uses Part": the Build's page reads "uses" the Part and the
    // Part's page reads "is used in" the Build.
    await this.jiraClient.createIssueLink(LinkType.USED_IN, buildKey, partKey);
  }

  /**
   * Read a Build by key and refuse anything but a Draft: 400 when the key
   * isn't a Build, 409 when the Build has been cut. Statuses come from the
   * tracker at write time, never from the client.
   *
   * @param {string} buildKey
   * @param {string[]} [fields]  Extra fields to read
   * @returns {Promise<object>} The Build issue
   * @private
   */
  async _requireDraftBuild(buildKey, fields = []) {
    const build = await getIssueOrNull(this.jiraClient, buildKey,
      [...new Set(['issuetype', 'status', BuildField.BUILD_NUMBER, ...fields])]);
    if (build?.fields?.issuetype?.name !== 'Build') {
      throw badRequest(`"${buildKey}" is not a Build`);
    }
    const status = build.fields.status?.name ?? null;
    if (isCutStatus(status)) {
      throw cutBuildConflict(buildLabelOf(build.fields[BuildField.BUILD_NUMBER], buildKey), status);
    }
    return build;
  }

  /**
   * Cut a Build's version: write the Onshape version link, transition it to
   * Active, and in the same action transition whichever sibling Build was
   * previously Active (under this same Assembly ticket — not the whole
   * revision chain, since a different Revision's history is its own) to
   * Superseded. This is the one moment ValorBOM drives the workflow instead
   * of a person (Sheet 02).
   *
   * A failure is tagged with the stage it happened in (`err.details.cutStage`:
   * 'link', 'transition' or 'supersede'), so the caller can tell what a
   * Retry will resume.
   *
   * @param {object} params
   * @param {string} params.buildKey
   * @param {string} params.assemblyKey        This Build's immediate parent
   * @param {string} params.onshapeVersionLink  The cut version's own URL
   * @param {string|null} [params.storedLink]   The link already on the Build;
   *   when it equals onshapeVersionLink the link write is skipped
   * @returns {Promise<{ superseded: string[] }>}
   */
  async cutVersion({ buildKey, assemblyKey, onshapeVersionLink, storedLink = null }) {
    if (storedLink !== onshapeVersionLink) {
      try {
        await this.jiraClient.updateIssue(buildKey, {
          [BuildField.ONSHAPE_VERSION_LINK]: onshapeVersionLink,
        });
      } catch (err) {
        throw withDetails(err, { cutStage: 'link' });
      }
    }

    try {
      await this.jiraClient.transitionIssue(buildKey, BuildTransition.CUT_VERSION);
    } catch (err) {
      throw withDetails(err, { cutStage: 'transition' });
    }

    const superseded = await this._supersedeActiveSiblings(buildKey, assemblyKey);
    return { superseded };
  }

  /**
   * Supersede every sibling Build that is Active, reading each status by key
   * (search reports a status change late). Any failure in here, the sibling
   * search included, is tagged `cutStage: 'supersede'`.
   *
   * @returns {Promise<string[]>} The superseded keys
   * @private
   */
  async _supersedeActiveSiblings(buildKey, assemblyKey) {
    try {
      const siblings = (await this.getBuildsForAssemblies([assemblyKey]))
        .filter((b) => b.key !== buildKey);
      const statuses = await inBatches(siblings, async (b) => {
        const issue = await this.jiraClient.getIssue(b.key, { fields: ['status'] });
        return { key: b.key, status: issue?.fields?.status?.name ?? null };
      });

      const superseded = [];
      for (const sibling of statuses) {
        if (sibling.status !== BuildStatus.ACTIVE) continue;
        await this.jiraClient.transitionIssue(sibling.key, BuildTransition.SUPERSEDE);
        superseded.push(sibling.key);
      }
      return superseded;
    } catch (err) {
      throw withDetails(err, { cutStage: 'supersede' });
    }
  }

  /**
   * The real end-to-end "cut the version" action: actually cuts a new
   * version in Onshape, then runs `cutVersion` with the real link that comes
   * back — the version isn't fabricated, it's the one Onshape just created.
   *
   * The OnShape ids come from the Assembly record, never the request. The
   * Build is checked by key first: a Build already cut answers 409, and a
   * cut that failed part-way resumes instead of making a second version.
   * Concurrent calls for one Build run one at a time.
   *
   * @param {object} params
   * @param {string} params.buildKey
   * @param {string} params.assemblyKey
   * @returns {Promise<{ onshapeVersionLink: string, superseded: string[], resumed: boolean }>}
   */
  async cutVersionFromOnshape({ buildKey, assemblyKey }) {
    if (!this.onshapeClient) {
      throw new Error('cutVersionFromOnshape requires an onshapeClient dependency');
    }
    return withKeyedLock(this._cutting, buildKey, () => this._cutOnce(buildKey, assemblyKey));
  }

  /** @private */
  async _cutOnce(buildKey, assemblyKey) {
    const [build, assembly] = await Promise.all([
      getIssueOrNull(this.jiraClient, buildKey, [
        'issuetype', 'status', BuildField.ASSEMBLY_LINK, BuildField.ONSHAPE_VERSION_LINK,
        BuildField.BUILD_NUMBER,
      ]),
      getIssueOrNull(this.jiraClient, assemblyKey, [
        'issuetype', 'customfield_10300', 'customfield_10301', 'customfield_10302',
      ]),
    ]);

    if (build?.fields?.issuetype?.name !== 'Build') {
      throw badRequest(`"${buildKey}" is not a Build`);
    }
    if (build.fields[BuildField.ASSEMBLY_LINK] !== assemblyKey) {
      throw badRequest(`"${buildKey}" isn't a Build of this Assembly`);
    }
    const assemblyType = assembly?.fields?.issuetype?.name;
    if (assemblyType !== 'Epic' && assemblyType !== 'Assembly') {
      throw badRequest(`"${assemblyKey}" is not an Assembly`);
    }

    const documentId = assembly.fields.customfield_10300;
    const workspaceId = assembly.fields.customfield_10301;
    const elementId = assembly.fields.customfield_10302;
    if (![documentId, workspaceId, elementId].every((id) => typeof id === 'string' && ONSHAPE_ID_RE.test(id))) {
      throw badRequest('This Assembly has no OnShape link.');
    }

    const stored = build.fields[BuildField.ONSHAPE_VERSION_LINK] ?? null;
    const storedLinkMatches = typeof stored === 'string'
      && new RegExp(`/documents/${documentId}/v/[^/]+/`).test(stored);
    const status = build.fields.status?.name ?? null;
    const number = build.fields[BuildField.BUILD_NUMBER];
    const label = number != null ? `Build ${number}` : buildKey;

    if (status === BuildStatus.ACTIVE && storedLinkMatches) {
      // A cut whose supersede stage failed: finish it.
      try {
        const superseded = await this._supersedeActiveSiblings(buildKey, assemblyKey);
        this._pictureOf(buildKey, number, assemblyKey, stored);
        this._queuePartFiles(buildKey, assemblyKey, stored);
        return { onshapeVersionLink: stored, superseded, resumed: true };
      } catch (err) {
        console.warn('[cut]', buildKey, 'stage', err?.details?.cutStage,
          'failed while resuming:', err?.status, err?.message, ...jiraErrorsForLog(err));
        throw withDetails(err, { onshapeVersionLink: stored });
      }
    }
    if (status !== BuildStatus.DRAFT) {
      throw conflict(`${label} has already been cut.`, { buildStatus: status });
    }

    let onshapeVersionLink;
    let resumed = false;
    if (storedLinkMatches) {
      // A previous attempt made the version and saved its link, then failed.
      onshapeVersionLink = stored;
      resumed = true;
    } else {
      await this._writeRevisions(buildKey, assemblyKey);
      const version = await this.onshapeClient.createVersion(documentId, workspaceId, {
        name: buildKey,
        description: `Cut from ValorBOM for ${buildKey}`,
      });
      onshapeVersionLink =
        `${this.onshapeClient.baseUrl}/documents/${documentId}/v/${version.id}/e/${elementId}`;
    }

    try {
      const { superseded } = await this.cutVersion({
        buildKey, assemblyKey, onshapeVersionLink, storedLink: stored,
      });
      this._pictureOf(buildKey, number, assemblyKey, onshapeVersionLink);
      this._queuePartFiles(buildKey, assemblyKey, onshapeVersionLink);
      return { onshapeVersionLink, superseded, resumed };
    } catch (err) {
      console.warn('[cut]', buildKey, 'stage', err?.details?.cutStage,
        'failed after the OnShape version was made:', err?.status, err?.message, ...jiraErrorsForLog(err));
      throw withDetails(err, { onshapeVersionLink });
    }
  }

  /**
   * Attach the Assembly's picture to the Build, in the background: it takes
   * several seconds and the cut does not wait for it. A Build that misses it
   * is given one the first time its picture is asked for.
   * @private
   */
  _pictureOf(buildKey, buildNumber, assemblyKey, versionLink) {
    if (!this.pictures) return;
    this.pictures.attachBuildImage({ buildKey, buildNumber, assemblyKey, versionLink })
      .then((result) => { if (result.problem) console.warn('[cut]', buildKey, "couldn't attach its picture:", result.problem); });
  }

  /**
   * Make OnShape show the Revision the tool holds for each Part in the Build,
   * before the version is cut, so the version carries them.
   * @private
   */
  async _writeRevisions(buildKey, assemblyKey) {
    if (!this.onshapeWriter) return;
    // The Build's own links, read by key: each carries its Part's summary,
    // and search (which lags a Re-create) isn't involved.
    const build = await this.jiraClient.getIssue(buildKey, { fields: ['issuelinks'] });
    const wanted = new Map();
    for (const link of build?.fields?.issuelinks ?? []) {
      if (link?.type?.name !== LinkType.USED_IN) continue;
      const part = applyPartMask((link.outwardIssue ?? link.inwardIssue)?.fields?.summary ?? '');
      const number = baseNumber(part);
      if (number && (wanted.get(number) ?? '') < part.version) wanted.set(number, part.version);
    }
    await this.onshapeWriter.setRevisions(assemblyKey, wanted);
  }

  /**
   * Part keys currently linked ("Used In") to a Build.
   *
   * Used to scope a BOM diff to "already in this build" vs. "exists under
   * the Assembly but not this Build" — the "shared with Build 1" indicator
   * from Sheet 05 — without assuming anything about which parts a Build has
   * beyond what's actually linked.
   *
   * @param {string} buildKey
   * @returns {Promise<string[]>}
   */
  async getLinkedParts(buildKey) {
    const safe = sanitizeJQL(buildKey);
    const jql = usedInLinkedClause(safe);
    const issues = await this.jiraClient.searchIssues(jql, {
      paginate: true,
      fields: ['summary'],
    });
    return issues.map((i) => i.key);
  }

  /**
   * Copy a sibling Build's part list onto a new Build — the "clone from a
   * sibling" option when creating a Build (Sheet 05). Only copies the link;
   * a part that needs to be different in the new Build is still a Re-create,
   * not something this touches.
   *
   * Keeps going past a Part whose link fails, so one bad link doesn't leave
   * the rest uncopied; reading the source Build's Parts failing still throws.
   *
   * @param {string} fromBuildKey
   * @param {string} toBuildKey
   * @returns {Promise<{ linked: string[], failed: { partKey: string, error: string,
   *   status: number|null, source: string|null }[] }>}
   */
  async cloneBuildParts(fromBuildKey, toBuildKey) {
    await this._requireDraftBuild(toBuildKey);
    const partKeys = await this.getLinkedParts(fromBuildKey);
    const linked = [];
    const failed = [];
    for (const partKey of partKeys) {
      try {
        await this._link(partKey, toBuildKey);
        linked.push(partKey);
      } catch (err) {
        console.warn('[clone]', partKey, 'into', toBuildKey, 'failed:', err?.status, err?.message);
        failed.push({
          partKey,
          error: describeUpstreamError(err),
          status: err?.status ?? null,
          source: upstreamSource(err),
        });
      }
    }
    return { linked, failed };
  }

  /**
   * Every Build a Part is linked ("Used In") to, newest first — what the
   * Assembly hub's current-build indicator (Sheet 06) is built from: the
   * highest buildNumber here is "current," the rest are history.
   *
   * @param {string} partKey
   * @returns {Promise<object[]>}
   */
  async getBuildsForPart(partKey) {
    const safe = sanitizeJQL(partKey);
    const jql = `${usedInLinkedClause(safe)} ORDER BY "Build Number" DESC`;
    const issues = await this.jiraClient.searchIssues(jql, { paginate: true });
    return this._parseBuilds(issues);
  }

  /**
   * One Designer or Assembly-page Save onto a Build: creates (find-or-create
   * by number across the Revision chain), updates and links, each reported
   * per item so one bad row can't block the rest. Reads that fail before
   * any write fail the whole call.
   *
   * @param {object} params
   * @param {string} params.buildKey
   * @param {object[]} [params.creates]
   * @param {object[]} [params.updates]
   * @param {object[]} [params.links]
   * @param {object[]} [params.copies]  `{ ref, from, quantity }`: an exact copy of a
   *   Part, for the units a Build needs that no ticket in it covers
   * @returns {Promise<{ results: object[] }>}
   */
  async saveBuildParts({ buildKey, creates = [], updates = [], links = [], copies = [] }) {
    if (!this.partService || !this.revisionService) {
      throw new HttpError(500, 'save needs partService and revisionService');
    }

    // 1. The Build, by key: a Draft, or the whole save is refused before
    // any write. Its Epic Link is the Assembly every create joins.
    const build = await this._requireDraftBuild(buildKey, [BuildField.ASSEMBLY_LINK]);
    const assemblyKey = build.fields[BuildField.ASSEMBLY_LINK];
    const number = build.fields[BuildField.BUILD_NUMBER];
    const buildLabel = number != null ? `Build ${number}` : buildKey;

    // 2. Reads. Any failure here is fatal, and nothing has been written.
    const memberKeys = [...new Set([...updates, ...links].map((i) => i.key))];
    const [linkedList, { chain, chainParts }, knownList] = await Promise.all([
      this.getLinkedParts(buildKey),
      (async () => {
        const keys = await this.revisionService.getRevisionChain(assemblyKey);
        return { chain: keys, chainParts: await this.partService.getStoriesByEpics(keys) };
      })(),
      memberKeys.length === 0 ? [] : this.partService.getStoriesByKeys(memberKeys).catch((err) => {
        // `key in (...)` is refused whole when any key doesn't exist.
        if (err?.name === 'JiraApiError' && err.status === 400) {
          console.warn('[save] key list rejected (400); checking', memberKeys.length, 'keys one by one');
          return [];
        }
        throw err;
      }),
    ]);

    const linked = new Set(linkedList);
    const chainSet = new Set(chain);
    const byNumber = new Map();
    for (const story of preferNewestRevision(chainParts, chain)) {
      if (story.fullPartNumber) byNumber.set(story.fullPartNumber, story);
    }

    const known = new Map(knownList.map((story) => [story.key, { ...story, isPart: true }]));
    const issuelinks = new Map();
    const lookupErrors = new Map();
    await inBatches(memberKeys.filter((k) => !known.has(k)), async (key) => {
      try {
        const issue = await getIssueOrNull(this.jiraClient, key,
          ['issuetype', 'summary', BuildField.ASSEMBLY_LINK, 'issuelinks']);
        if (!issue) return;
        known.set(key, {
          key,
          summary: issue.fields?.summary ?? '',
          epic: issue.fields?.[BuildField.ASSEMBLY_LINK] ?? null,
          isPart: issue.fields?.issuetype?.name === 'Part',
        });
        issuelinks.set(key, issue.fields?.issuelinks ?? []);
      } catch (err) {
        lookupErrors.set(key, err);
      }
    });

    const createdHere = new Set();
    const results = [];
    const fail = (base, err, prefix = '') => {
      console.warn('[save]', buildKey, base.op, base.ref, 'failed:', err?.status, err?.message,
        ...jiraErrorsForLog(err));
      return {
        ...base,
        ok: false,
        error: prefix + describeUpstreamError(err),
        status: err?.status ?? null,
        source: upstreamSource(err),
      };
    };
    const notMember = (key) => `${key} isn't a Part of this Assembly`;

    // Link one Part unless it is already in the Build. `fresh` skips the
    // issuelinks check for a Part created in this request.
    const link = async (key, fresh) => {
      if (linked.has(key)) return { alreadyLinked: true };
      if (!fresh) {
        let entries = issuelinks.get(key);
        if (entries === undefined) {
          try {
            const issue = await this.jiraClient.getIssue(key, { fields: ['issuelinks'] });
            entries = issue?.fields?.issuelinks ?? [];
          } catch (err) {
            return { checkError: err };
          }
        }
        if (hasUsedInLink(entries, buildKey)) {
          linked.add(key);
          return { alreadyLinked: true };
        }
      }
      try {
        await this._link(key, buildKey);
      } catch (err) {
        return { linkError: err };
      }
      linked.add(key);
      return { alreadyLinked: false };
    };

    // A Part a cut Build uses keeps its fields: `lockedBy` answers that
    // Part's cut Builds (empty when none), reading its links by key.
    const buildStates = new Map();
    const lockedBy = async (key) => {
      let entries = issuelinks.get(key);
      if (entries === undefined) {
        const issue = await this.jiraClient.getIssue(key, { fields: ['issuelinks'] });
        entries = issue?.fields?.issuelinks ?? [];
        issuelinks.set(key, entries);
      }
      return cutBuildsAmong(this.jiraClient, usedInKeys(entries).filter((k) => k !== buildKey), buildStates);
    };
    const lockedResult = (base, label, cut) => {
      const err = sharedPartConflict(label, cut);
      return {
        ...base, ok: false, error: err.message, status: 409, source: null, locked: true, cutBuilds: err.details.cutBuilds,
      };
    };

    // 2b. Parts the tool numbers (a `cadRef` instead of a number): check each
    // against the Assembly's own BOM, then take numbers for them together.
    const numbering = new Map();
    let assemblyUnnumbered = false;
    const toNumber = creates.filter((i) => i.cadRef);
    if (toNumber.length > 0) {
      if (!this.onshapeWriter || !this.partNumbers) {
        throw new HttpError(500, 'numbering needs onshapeWriter and partNumbers');
      }
      const { byRef, takenByPrefix, assemblyNumber } = await this.onshapeWriter.numberingContext(assemblyKey);
      const block = blockOf(assemblyNumber);
      assemblyUnnumbered = block === null;
      const byPrefix = new Map();
      for (const item of toNumber) {
        const part = byRef.get(item.cadRef);
        if (!part || block === null) continue;
        const list = byPrefix.get(part.numbering.prefix) ?? [];
        list.push({ item, part });
        byPrefix.set(part.numbering.prefix, list);
      }
      for (const [prefix, list] of byPrefix) {
        const wanted = list.map(({ item }) => {
          const proposed = applyPartMask(item.summary ?? '');
          return proposed && `V${proposed.seasonType}${proposed.year}` === prefix ? proposed.partNumber : null;
        });
        // eslint-disable-next-line no-await-in-loop
        const claimed = await this.partNumbers.claim(prefix, block, wanted, takenByPrefix.get(prefix) ?? []);
        list.forEach(({ item, part }, i) => numbering.set(item.ref, { part, prefix, number: claimed[i] }));
      }
    }

    // 3. Creates.
    for (let item of creates) {
      const base = { ref: item.ref, op: 'create', key: null, reused: false, updated: false, linked: false, alreadyLinked: false };
      if (item.cadRef) {
        const plan = numbering.get(item.ref);
        if (!plan) {
          results.push({
            ...base,
            ok: false,
            error: assemblyUnnumbered
              ? "This Assembly has no 4-digit number (like VR27A-1100), so its Parts can't be numbered."
              : "This part isn't waiting for a number in OnShape any more. Click Update from CAD and try again.",
          });
          continue;
        }
        // The name and number come from the tool's own read of OnShape, never the client's.
        const summary = formatPartNumber({ ...plan.part, partNumber: plan.number, version: 'A' });
        item = { ...item, summary, revision: 'A' };
        base.fullPartNumber = summary.split(' ')[0];
      }
      const problem = fieldProblem(item);
      if (problem) {
        if (item.cadRef) this.partNumbers.forget(numbering.get(item.ref).prefix, numbering.get(item.ref).number);
        results.push({ ...base, ok: false, ...problem });
        continue;
      }
      const parsed = applyPartMask(item.summary);
      if (item.revision !== undefined && item.revision !== null) {
        if (!/^[A-Z]$/.test(item.revision)) {
          results.push({ ...base, ok: false, field: 'revision', error: 'Revision must be one capital letter.' });
          continue;
        }
        if (item.revision !== parsed.version) {
          results.push({
            ...base, ok: false, field: 'revision',
            error: `Revision ${item.revision} doesn't match the number's letter ${parsed.version} in ${parsed.fullPartNumber}`,
          });
          continue;
        }
      }

      if (item.revises) {
        const revised = chainParts.find((p) => p.key === item.revises);
        if (!revised || baseNumber(revised) !== baseNumber(parsed) || (revised.version ?? '') >= parsed.version) {
          if (item.cadRef) this.partNumbers.forget(numbering.get(item.ref).prefix, numbering.get(item.ref).number);
          results.push({
            ...base, ok: false, field: 'revises',
            error: `${item.revises} isn't the earlier Revision of ${parsed.fullPartNumber}.`,
          });
          continue;
        }
      }

      const values = bomValues(item);
      const existing = byNumber.get(parsed.fullPartNumber);
      if (existing) {
        base.key = existing.key;
        base.reused = true;
        // Both sides with the same defaults, so an unset field equals its None/No.
        const stored = bomValues(existing);
        const differs = ['quantity', 'material', 'machinery', 'powdercoat']
          .some((f) => stored[f] !== values[f]);
        if (differs) {
          let cut;
          try {
            cut = await lockedBy(existing.key);
          } catch (err) {
            results.push(fail(base, err));
            continue;
          }
          if (cut.length) {
            results.push(lockedResult(base, parsed.fullPartNumber, cut));
            continue;
          }
          try {
            await this.partService.updateStory(existing.key, { ...values, summary: existing.summary },
              { cutBuildsChecked: true });
            byNumber.set(parsed.fullPartNumber, { ...existing, ...values });
            base.updated = true;
          } catch (err) {
            results.push(fail(base, err, "Already existed, but couldn't update it: "));
            continue;
          }
        }
      } else {
        const plan = item.cadRef ? numbering.get(item.ref) : null;
        if (plan) {
          try {
            await this.onshapeWriter.number(plan.part, plan.number);
          } catch (err) {
            this.partNumbers.forget(plan.prefix, plan.number);
            results.push(fail(base, err, "Couldn't number it in OnShape: "));
            continue;
          }
        }
        try {
          const created = await this.partService.createStory({
            summary: item.summary,
            revision: item.revision ?? undefined,
            ...values,
            epic: assemblyKey,
          });
          base.key = created.key;
          createdHere.add(created.key);
          byNumber.set(parsed.fullPartNumber, {
            ...parsed, key: created.key, summary: item.summary, epic: assemblyKey, ...values,
          });
        } catch (err) {
          results.push(fail(base, err, plan ? `Numbered ${base.fullPartNumber} in OnShape, but couldn't create the Part: ` : ''));
          continue;
        }
      }

      const outcome = await link(base.key, createdHere.has(base.key));
      if (outcome.checkError) {
        results.push(fail(base, outcome.checkError));
      } else if (outcome.linkError) {
        const prefix = base.reused
          ? `Already existed, but not added to ${buildLabel}: `
          : `Created, but not added to ${buildLabel}: `;
        results.push(fail(base, outcome.linkError, prefix));
      } else if (item.revises) {
        const problems = await this._swapRevision(item.revises, base.key, buildKey, buildLabel, linked);
        results.push({
          ...base,
          ok: true,
          linked: true,
          alreadyLinked: outcome.alreadyLinked,
          replaced: problems.length === 0 ? item.revises : null,
          ...(problems.length ? { note: `Made ${parsed.fullPartNumber}, but ${problems.join(' and ')}.` } : {}),
        });
      } else {
        results.push({ ...base, ok: true, linked: true, alreadyLinked: outcome.alreadyLinked });
      }
    }

    // 3b. Copies: units the Build needs that no Part in it already covers.
    for (const item of copies) {
      const base = { ref: item.ref, op: 'copy', key: null, linked: false, alreadyLinked: false };
      const source = chainParts.find((p) => p.key === item.from);
      if (!source) {
        results.push({ ...base, ok: false, error: notMember(item.from) });
        continue;
      }
      if (!validateQuantity(item.quantity).valid) {
        results.push({ ...base, ok: false, field: 'quantity', error: 'Quantity must be a whole number of 1 or more.' });
        continue;
      }
      let made;
      try {
        made = await this.partService.clonePart({ sourceKey: item.from, epicKey: assemblyKey, quantity: item.quantity });
      } catch (err) {
        results.push(fail(base, err));
        continue;
      }
      Object.assign(base, { key: made.key, fullPartNumber: made.fullPartNumber, part: made.part });
      createdHere.add(made.key);
      const outcome = await link(made.key, true);
      if (outcome.checkError || outcome.linkError) {
        results.push(fail(base, outcome.checkError ?? outcome.linkError,
          `Made ${made.fullPartNumber}, but not added to ${buildLabel}: `));
      } else {
        results.push({ ...base, ok: true, linked: true, alreadyLinked: outcome.alreadyLinked });
      }
    }

    const memberFor = (key) => {
      const entry = known.get(key);
      return entry && entry.isPart && chainSet.has(entry.epic) ? entry : null;
    };

    // 4. Updates.
    for (const item of updates) {
      const base = { ref: item.ref, op: 'update', key: item.key, linked: false, alreadyLinked: false };
      if (lookupErrors.has(item.key)) {
        results.push(fail(base, lookupErrors.get(item.key)));
        continue;
      }
      const entry = memberFor(item.key);
      if (!entry) {
        results.push({ ...base, ok: false, error: notMember(item.key) });
        continue;
      }
      const problem = fieldProblem(item);
      if (problem) {
        results.push({ ...base, ok: false, ...problem });
        continue;
      }
      let cut;
      try {
        cut = await lockedBy(item.key);
      } catch (err) {
        results.push(fail(base, err));
        continue;
      }
      if (cut.length) {
        results.push(lockedResult(base, applyPartMask(entry.summary ?? '')?.fullPartNumber ?? item.key, cut));
        continue;
      }
      try {
        // The stored summary, never the client's: a Save can't renumber a Part.
        await this.partService.updateStory(item.key, { ...bomValues(item), summary: entry.summary },
          { cutBuildsChecked: true });
      } catch (err) {
        results.push(fail(base, err));
        continue;
      }
      if (item.link !== true) {
        results.push({ ...base, ok: true, linked: linked.has(item.key) });
        continue;
      }
      const outcome = await link(item.key, false);
      if (outcome.checkError) {
        results.push(fail(base, outcome.checkError, `Saved, but not added to ${buildLabel}: `));
      } else if (outcome.linkError) {
        results.push(fail(base, outcome.linkError, `Saved, but not added to ${buildLabel}: `));
      } else {
        results.push({ ...base, ok: true, linked: true, alreadyLinked: outcome.alreadyLinked });
      }
    }

    // 5. Links.
    for (const item of links) {
      const base = { ref: item.ref, op: 'link', key: item.key, linked: false, alreadyLinked: false };
      if (lookupErrors.has(item.key)) {
        results.push(fail(base, lookupErrors.get(item.key)));
        continue;
      }
      if (!memberFor(item.key)) {
        results.push({ ...base, ok: false, error: notMember(item.key) });
        continue;
      }
      const outcome = await link(item.key, false);
      if (outcome.checkError || outcome.linkError) {
        results.push(fail(base, outcome.checkError ?? outcome.linkError,
          `Not added to ${buildLabel}: `));
      } else {
        results.push({ ...base, ok: true, linked: true, alreadyLinked: outcome.alreadyLinked });
      }
    }

    return { results };
  }

  /**
   * Queue the picture, STEP and DXF of every Part linked to this Build. Runs
   * once the Build is ready to build (Cut Version), not at Save: a Draft's
   * Parts may still change shape, and each of these costs an OnShape call a
   * Part that never ships shouldn't have spent. A job already done or
   * failed is handled by FileJobs' own dedup; this never waits for them.
   * @private
   */
  /**
   * Make the files a cut Build's Parts are missing (a job lost to a restart,
   * one that failed, a Part added since): queue only those Parts, from the
   * Build's own cut version. The files each already has are kept, so a job
   * makes only what's missing.
   *
   * @param {string} buildKey
   * @returns {Promise<{ queued: string[], missing: Record<string, string[]> }>}
   */
  async queueMissingFiles(buildKey) {
    if (!this.fileJobs || !this.partService) throw new HttpError(503, 'Files can\'t be made on this server.');
    const build = await this.jiraClient.getIssue(buildKey, {
      fields: ['status', 'issuetype', BuildField.ASSEMBLY_LINK, BuildField.ONSHAPE_VERSION_LINK],
    });
    if (build?.fields?.issuetype?.name && build.fields.issuetype.name !== 'Build') throw badRequest(`${buildKey} is not a Build.`);
    const status = build?.fields?.status?.name ?? null;
    const versionLink = build?.fields?.[BuildField.ONSHAPE_VERSION_LINK] ?? null;
    if (status === BuildStatus.DRAFT || !versionLink) {
      throw conflict('Files are made when the Build is cut; this one is still a Draft.', { buildStatus: status });
    }
    const assemblyKey = build.fields[BuildField.ASSEMBLY_LINK];
    const keys = await this.getLinkedParts(buildKey);
    const stories = keys.length ? await this.partService.getStoriesByKeys(keys, { files: true }) : [];
    const queued = [];
    const missing = {};
    for (const story of stories) {
      const gaps = missingFiles(story);
      if (!story.fullPartNumber || !gaps?.length) continue;
      missing[story.key] = gaps;
      const added = this.fileJobs.enqueue({
        key: story.key,
        partNumber: story.fullPartNumber,
        thickness: story.thickness,
        material: story.material,
        machinery: story.machinery,
        tapping: story.tapping,
        assemblyKey,
        versionLink,
      });
      if (added) queued.push(story.key);
    }
    return { queued, missing };
  }

  _queuePartFiles(buildKey, assemblyKey, versionLink = null) {
    if (!this.fileJobs || !this.partService) return undefined;
    // Returns the promise so a test (or a future caller) can await it;
    // _cutOnce itself does not, since the cut shouldn't wait on it.
    return this.getLinkedParts(buildKey)
      .then((keys) => (keys.length ? this.partService.getStoriesByKeys(keys) : []))
      .then((stories) => {
        for (const story of stories) {
          if (!story.fullPartNumber) continue;
          this.fileJobs.enqueue({
            key: story.key,
            partNumber: story.fullPartNumber,
            thickness: story.thickness,
            material: story.material,
            machinery: story.machinery,
            tapping: story.tapping,
            assemblyKey,
            versionLink,
          });
        }
      })
      .catch((err) => console.warn('[cut]', buildKey, 'could not queue Part files:', err?.status, err?.message));
  }

  /**
   * The new Revision takes the old one's place: record that it revises the
   * old Part, and take the old Part out of this Build so the Build never
   * lists both. Safe to repeat. Returns what could not be done, in words.
   *
   * @returns {Promise<string[]>}
   * @private
   */
  async _swapRevision(oldKey, newKey, buildKey, buildLabel, linked) {
    let entries;
    try {
      entries = (await this.jiraClient.getIssue(oldKey, { fields: ['issuelinks'] }))?.fields?.issuelinks ?? [];
    } catch (err) {
      console.warn('[save] could not read', oldKey, 'to swap in', newKey, ':', err?.status, err?.message);
      return [`couldn't read ${oldKey} to swap it out of ${buildLabel}`];
    }
    const touches = (link, key) => link?.outwardIssue?.key === key || link?.inwardIssue?.key === key;
    const problems = [];

    if (!entries.some((l) => l?.type?.name === LinkType.REVISES && touches(l, newKey))) {
      try {
        await this.jiraClient.createIssueLink(LinkType.REVISES, newKey, oldKey);
      } catch (err) {
        console.warn('[save] Revises link', newKey, '->', oldKey, 'failed:', err?.status, err?.message);
        problems.push(`couldn't record that it revises ${oldKey}`);
      }
    }
    const used = entries.find((l) => l?.type?.name === LinkType.USED_IN && touches(l, buildKey));
    if (used) {
      try {
        await this.jiraClient.deleteIssueLink(used.id);
        linked.delete(oldKey);
      } catch (err) {
        console.warn('[save] could not take', oldKey, 'out of', buildKey, ':', err?.status, err?.message);
        problems.push(`couldn't take ${oldKey} out of ${buildLabel}`);
      }
    }
    return problems;
  }

  /**
   * Archive a Build — the one status change left for a human to trigger on
   * purpose, since there's no data signal for "this is a dead end."
   *
   * @param {string} buildKey
   * @returns {Promise<void>}
   */
  async archiveBuild(buildKey) {
    await this.jiraClient.transitionIssue(buildKey, BuildTransition.ARCHIVE);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Parse raw Jira issues into Build objects.
   * @private
   */
  _parseBuilds(issues) {
    return issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields?.summary ?? '',
      assemblyKey: issue.fields?.[BuildField.ASSEMBLY_LINK] ?? null,
      buildNumber: issue.fields?.[BuildField.BUILD_NUMBER] ?? null,
      onshapeVersionLink: issue.fields?.[BuildField.ONSHAPE_VERSION_LINK] ?? null,
      instructionsData: issue.fields?.[BuildField.INSTRUCTIONS_DATA] ?? null,
      status: issue.fields?.status?.name ?? null,
    }));
  }
}
