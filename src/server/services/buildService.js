/**
 * Build Service — manages Build issues: creation, continuous numbering
 * across an Assembly's revision chain, the Part <-> Build "Used In" link,
 * and driving Build's own workflow (Draft -> Active -> Superseded, plus
 * Archive) so nobody has to flip a status by hand.
 */

import {
  sanitizeJQL, validateMaterial, validateMachinery, validatePowdercoat, validateThickness, validateQuantity,
} from '../utils/validators.js';
import {
  BuildField, BuildStatus, BuildTransition, LinkType, RevisionField, usedInLinkedClause,
} from '../utils/buildConstants.js';
import { applyPartMask, formatPartNumber } from '../utils/partMask.js';
import { Powdercoat, Thickness } from '../utils/bomConstants.js';
import { nextRevisionLetter } from './revisionService.js';
import { partFromWritten } from './partService.js';
import { badRequest, conflict, HttpError } from '../middleware/httpError.js';
import { describeUpstreamError, upstreamSource } from '../utils/upstreamError.js';
import { preferNewestRevision } from '../utils/partChain.js';
import { withKeyedLock } from '../utils/keyedLock.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

/** Parallel by-key reads are sent in batches of this size. */
const READ_BATCH = 10;

/** How long a Re-create is remembered for the repeat guard. */
const RECENT_MS = 10 * 60 * 1000;

const ONSHAPE_ID_RE = /^[a-f0-9]{24}$/i;

/** Per-item field checks for a save, in the order they are reported. */
const FIELD_CHECKS = [
  ['material', 'Material', validateMaterial],
  ['machinery', 'Machinery', validateMachinery],
  ['powdercoat', 'Powdercoat', validatePowdercoat],
  ['thickness', 'Thickness', validateThickness],
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

/** The BOM values a save writes, with None for an absent Powdercoat/Thickness. */
function bomValues(item) {
  return {
    quantity: item.quantity,
    material: item.material,
    machinery: item.machinery,
    powdercoat: item.powdercoat ?? Powdercoat.NONE,
    thickness: item.thickness ?? Thickness.NONE,
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
   *   Required for `recreateForBuild` and `saveBuildParts`.
   * @param {import('./partService.js').PartService} [deps.partService]
   *   Required for `recreateForBuild` and `saveBuildParts`.
   */
  constructor({ jiraClient, onshapeClient, revisionService, partService }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.revisionService = revisionService;
    this.partService = partService;
    /** In-flight Re-creates by source Part key. */
    this._recreating = new Map();
    /** Source Part key -> { key, at } for Re-creates in the last 10 minutes. */
    this._recentlyRecreated = new Map();
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
   * The Build Number the next Build under this Assembly should get.
   * Continuous across the whole revision chain — never resets when a new
   * Revision starts (Sheet 01 of the plan).
   *
   * @param {string[]} revisionChainKeys  Every ticket in the Assembly's
   *   revision chain, oldest or newest first — order doesn't matter here.
   * @returns {Promise<number>}
   */
  async getNextBuildNumber(revisionChainKeys) {
    const builds = await this.getBuildsForAssemblies(revisionChainKeys);
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
   * and unioned with any keys the caller sent, so a stale client copy can
   * only raise the next number, never reuse one.
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

    const buildNumber = await this.getNextBuildNumber(chainKeys);
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
    // Part reads "is used in" the Build; Build reads "uses" the Part —
    // matches the inward/outward phrasing the link type was created with.
    await this.jiraClient.createIssueLink(LinkType.USED_IN, partKey, buildKey);
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
        return { onshapeVersionLink: stored, superseded, resumed: true };
      } catch (err) {
        console.warn('[cut]', buildKey, 'stage', err?.details?.cutStage,
          'failed while resuming:', err?.status, err?.message);
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
      return { onshapeVersionLink, superseded, resumed };
    } catch (err) {
      console.warn('[cut]', buildKey, 'stage', err?.details?.cutStage,
        'failed after the OnShape version was made:', err?.status, err?.message);
      throw withDetails(err, { onshapeVersionLink });
    }
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
    const partKeys = await this.getLinkedParts(fromBuildKey);
    const linked = [];
    const failed = [];
    for (const partKey of partKeys) {
      try {
        await this.linkPartToBuild(partKey, toBuildKey);
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
   * "Re-create for this Build" (Sheet 06): the design changed, so this Part
   * needs a new revision rather than just being moved forward. Creates a new
   * Part ticket one revision letter ahead, carrying forward its BOM fields,
   * chained back via Revises, and links only the new ticket into the target
   * Build — the old one stays exactly as it was for whichever Build it
   * actually shipped in (Sheet 07).
   *
   * Refuses (409 with `recreatedAs`) a Part that was already re-created, so
   * a double click, a second tab or a lagging list can't make two copies of
   * the next Revision. Concurrent calls for one Part run one at a time.
   *
   * @param {object} params
   * @param {string} params.partKey        The Part being re-created
   * @param {string} params.targetBuildKey The Build the new revision belongs to
   * @returns {Promise<{ key: string, revision: string, part: object }>}
   */
  async recreateForBuild({ partKey, targetBuildKey }) {
    if (!this.revisionService) {
      throw new Error('recreateForBuild requires a revisionService dependency');
    }
    if (!this.partService) {
      throw new HttpError(500, 'recreateForBuild needs partService');
    }
    return withKeyedLock(this._recreating, partKey,
      () => this._recreateOnce(partKey, targetBuildKey));
  }

  /** @private */
  async _recreateOnce(partKey, targetBuildKey) {
    const [previous, target] = await Promise.all([
      this.jiraClient.getIssue(partKey, {
        fields: [
          'summary',
          RevisionField.REVISION,
          'customfield_10110', // Epic Link
          'customfield_10201', // Machinery
          'customfield_10202', // Material
          'customfield_10204', // Powdercoat
          'customfield_10206', // Quantity
          'customfield_10207', // Thickness
          'issuelinks',
        ],
      }),
      getIssueOrNull(this.jiraClient, targetBuildKey, ['issuetype', BuildField.ASSEMBLY_LINK]),
    ]);

    if (target?.fields?.issuetype?.name !== 'Build') {
      throw badRequest(`"${targetBuildKey}" is not a Build`);
    }
    // The target Build's chain: a Revision B Build admits a Revision A Part.
    const chain = await this.revisionService.getRevisionChain(target.fields[BuildField.ASSEMBLY_LINK]);
    if (!chain.includes(previous.fields?.customfield_10110)) {
      throw badRequest(`"${partKey}" isn't a Part of this Assembly`);
    }

    const parsed = applyPartMask(previous.fields?.summary ?? '');
    if (!parsed) {
      throw badRequest(`"${partKey}" summary does not match the Part number format`);
    }

    const currentRevision = previous.fields?.[RevisionField.REVISION] ?? null;
    const nextRevision = nextRevisionLetter(currentRevision);
    const summary = formatPartNumber({ ...parsed, version: nextRevision });
    const newNumber = applyPartMask(summary).fullPartNumber;

    const refuse = (recreatedAs) => conflict(
      `${partKey} was already re-created as ${recreatedAs}. Re-create ${recreatedAs} instead.`,
      { recreatedAs },
    );

    const revisedAs = this._laterRevisionLink(previous.fields?.issuelinks, parsed);
    if (revisedAs) throw refuse(revisedAs);

    const recent = this._recentlyRecreated.get(partKey);
    if (recent && Date.now() - recent.at < RECENT_MS) throw refuse(recent.key);

    const chainParts = await this.partService.getStoriesByEpics(chain);
    const sameNumber = chainParts.find((p) => p.fullPartNumber === newNumber);
    if (sameNumber) throw refuse(sameNumber.key);

    const extraFields = {
      customfield_10110: previous.fields?.customfield_10110 ?? null, // Epic Link
      customfield_10201: previous.fields?.customfield_10201, // Machinery
      customfield_10202: previous.fields?.customfield_10202, // Material
      customfield_10206: previous.fields?.customfield_10206, // Quantity
    };
    if (previous.fields?.customfield_10204) extraFields.customfield_10204 = previous.fields.customfield_10204;
    if (previous.fields?.customfield_10207) extraFields.customfield_10207 = previous.fields.customfield_10207;

    let result;
    try {
      result = await this.revisionService.createRevision({
        previousKey: partKey,
        issueTypeName: 'Part',
        summary,
        extraFields,
      });
    } catch (err) {
      if (err?.details?.stage === 'revises-link') {
        // The ticket exists but isn't recorded as a revision; don't add it
        // to the Build, and refuse a Retry until search catches up.
        this._recentlyRecreated.set(partKey, { key: err.details.key, at: Date.now() });
        withDetails(err, {
          part: partFromWritten(err.details.key, summary, {
            ...extraFields, [RevisionField.REVISION]: err.details.revision,
          }),
        });
      }
      throw err;
    }

    this._recentlyRecreated.set(partKey, { key: result.key, at: Date.now() });
    const part = partFromWritten(result.key, summary, {
      ...extraFields, [RevisionField.REVISION]: result.revision,
    });

    try {
      await this.linkPartToBuild(result.key, targetBuildKey);
    } catch (err) {
      throw withDetails(err, { key: result.key, part, stage: 'used-in-link' });
    }
    return { key: result.key, revision: result.revision, part };
  }

  /**
   * The key of a later Revision of this Part named by one of its `Revises`
   * links, on either side: same number, a later letter. An earlier letter is
   * the Part this one revised and is ignored.
   * @private
   */
  _laterRevisionLink(issuelinks, parsed) {
    let best = null;
    for (const link of issuelinks ?? []) {
      if (link?.type?.name !== LinkType.REVISES) continue;
      const other = link.outwardIssue ?? link.inwardIssue;
      const linked = applyPartMask(other?.fields?.summary ?? '');
      if (!linked || linked.isEpic) continue;
      if (linked.seasonType !== parsed.seasonType || linked.year !== parsed.year
        || linked.partNumber !== parsed.partNumber) continue;
      if (linked.version <= parsed.version) continue;
      if (!best || linked.version > best.version) best = { key: other.key, version: linked.version };
    }
    return best?.key ?? null;
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
   * @returns {Promise<{ results: object[] }>}
   */
  async saveBuildParts({ buildKey, creates = [], updates = [], links = [] }) {
    if (!this.partService || !this.revisionService) {
      throw new HttpError(500, 'save needs partService and revisionService');
    }

    // 1. The Build, by key. Its Epic Link is the Assembly every create joins.
    const build = await getIssueOrNull(this.jiraClient, buildKey,
      ['issuetype', BuildField.ASSEMBLY_LINK, BuildField.BUILD_NUMBER]);
    if (build?.fields?.issuetype?.name !== 'Build') {
      throw badRequest(`"${buildKey}" is not a Build`);
    }
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
      console.warn('[save]', buildKey, base.op, base.ref, 'failed:', err?.status, err?.message);
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
        await this.linkPartToBuild(key, buildKey);
      } catch (err) {
        return { linkError: err };
      }
      linked.add(key);
      return { alreadyLinked: false };
    };

    // 3. Creates.
    for (const item of creates) {
      const base = { ref: item.ref, op: 'create', key: null, reused: false, updated: false, linked: false, alreadyLinked: false };
      const problem = fieldProblem(item);
      if (problem) {
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

      const values = bomValues(item);
      const existing = byNumber.get(parsed.fullPartNumber);
      if (existing) {
        base.key = existing.key;
        base.reused = true;
        const differs = ['quantity', 'material', 'machinery', 'powdercoat', 'thickness']
          .some((f) => existing[f] !== values[f]);
        if (differs) {
          try {
            await this.partService.updateStory(existing.key, { ...values, summary: existing.summary });
            byNumber.set(parsed.fullPartNumber, { ...existing, ...values });
            base.updated = true;
          } catch (err) {
            results.push(fail(base, err, "Already existed, but couldn't update it: "));
            continue;
          }
        }
      } else {
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
          results.push(fail(base, err));
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
      try {
        // The stored summary, never the client's: a Save can't renumber a Part.
        await this.partService.updateStory(item.key, { ...bomValues(item), summary: entry.summary });
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
