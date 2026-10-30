/**
 * Build Service — manages Build issues: creation, continuous numbering
 * across an Assembly's revision chain, the Part <-> Build "Used In" link,
 * and driving Build's own workflow (Draft -> Active -> Superseded, plus
 * Archive) so nobody has to flip a status by hand.
 */

import { sanitizeJQL } from '../utils/validators.js';
import { BuildField, BuildStatus, BuildTransition, LinkType, RevisionField } from '../utils/buildConstants.js';
import { applyPartMask, formatPartNumber } from '../utils/partMask.js';
import { nextRevisionLetter } from './revisionService.js';
import { badRequest } from '../middleware/httpError.js';
import { describeUpstreamError, upstreamSource } from '../utils/upstreamError.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

export class BuildService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('../clients/onshapeClient.js').OnshapeClient} [deps.onshapeClient]
   *   Only required for `cutVersionFromOnshape`; `cutVersion` itself is pure
   *   Jira and doesn't need it.
   * @param {import('./revisionService.js').RevisionService} [deps.revisionService]
   *   Only required for `recreateForBuild`.
   */
  constructor({ jiraClient, onshapeClient, revisionService }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.revisionService = revisionService;
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
   * @param {object} params
   * @param {string} params.buildKey
   * @param {string} params.assemblyKey        This Build's immediate parent
   * @param {string} params.onshapeVersionLink  The cut version's own URL
   * @returns {Promise<{ superseded: string[] }>}
   */
  async cutVersion({ buildKey, assemblyKey, onshapeVersionLink }) {
    await this.jiraClient.updateIssue(buildKey, {
      [BuildField.ONSHAPE_VERSION_LINK]: onshapeVersionLink,
    });
    await this.jiraClient.transitionIssue(buildKey, BuildTransition.CUT_VERSION);

    const siblings = await this.getBuildsForAssemblies([assemblyKey]);
    const previouslyActive = siblings.filter(
      (b) => b.key !== buildKey && b.status === BuildStatus.ACTIVE,
    );

    for (const sibling of previouslyActive) {
      await this.jiraClient.transitionIssue(sibling.key, BuildTransition.SUPERSEDE);
    }

    return { superseded: previouslyActive.map((b) => b.key) };
  }

  /**
   * The real end-to-end "cut the version" action: actually cuts a new
   * version in Onshape, then runs `cutVersion` with the real link that comes
   * back — the version isn't fabricated, it's the one Onshape just created.
   *
   * Mirrors the same onshapeClient+jiraClient orchestration EpicService
   * already does for resolving a pasted URL into a new Assembly.
   *
   * @param {object} params
   * @param {string} params.buildKey
   * @param {string} params.assemblyKey
   * @param {string} params.documentId
   * @param {string} params.workspaceId   The workspace the Build's design work happened in
   * @param {string} params.elementId
   * @returns {Promise<{ onshapeVersionLink: string, superseded: string[] }>}
   */
  async cutVersionFromOnshape({ buildKey, assemblyKey, documentId, workspaceId, elementId }) {
    if (!this.onshapeClient) {
      throw new Error('cutVersionFromOnshape requires an onshapeClient dependency');
    }

    const version = await this.onshapeClient.createVersion(documentId, workspaceId, {
      name: buildKey,
      description: `Cut from ValorBOM for ${buildKey}`,
    });

    const onshapeVersionLink =
      `${this.onshapeClient.baseUrl}/documents/${documentId}/v/${version.id}/e/${elementId}`;

    const { superseded } = await this.cutVersion({ buildKey, assemblyKey, onshapeVersionLink });
    return { onshapeVersionLink, superseded };
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
    const jql = `issue in linkedIssues(${safe}, "${LinkType.USED_IN}")`;
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
    const jql = `issue in linkedIssues(${safe}, "${LinkType.USED_IN}") ORDER BY "Build Number" DESC`;
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
   * @param {object} params
   * @param {string} params.partKey        The Part being re-created
   * @param {string} params.targetBuildKey The Build the new revision belongs to
   * @returns {Promise<{ key: string, revision: string }>}
   */
  async recreateForBuild({ partKey, targetBuildKey }) {
    if (!this.revisionService) {
      throw new Error('recreateForBuild requires a revisionService dependency');
    }

    const previous = await this.jiraClient.getIssue(partKey, {
      fields: [
        'summary',
        RevisionField.REVISION,
        'customfield_10110', // Epic Link
        'customfield_10201', // Machinery
        'customfield_10202', // Material
        'customfield_10204', // Powdercoat
        'customfield_10206', // Quantity
        'customfield_10207', // Thickness
      ],
    });

    const parsed = applyPartMask(previous.fields?.summary ?? '');
    if (!parsed) {
      throw new Error(`"${partKey}" summary does not match the Part number format`);
    }

    const currentRevision = previous.fields?.[RevisionField.REVISION] ?? null;
    const nextRevision = nextRevisionLetter(currentRevision);
    const summary = formatPartNumber({ ...parsed, version: nextRevision });

    const extraFields = {
      customfield_10110: previous.fields?.customfield_10110 ?? null, // Epic Link
      customfield_10201: previous.fields?.customfield_10201, // Machinery
      customfield_10202: previous.fields?.customfield_10202, // Material
      customfield_10206: previous.fields?.customfield_10206, // Quantity
    };
    if (previous.fields?.customfield_10204) extraFields.customfield_10204 = previous.fields.customfield_10204;
    if (previous.fields?.customfield_10207) extraFields.customfield_10207 = previous.fields.customfield_10207;

    const result = await this.revisionService.createRevision({
      previousKey: partKey,
      issueTypeName: 'Part',
      summary,
      extraFields,
    });

    await this.linkPartToBuild(result.key, targetBuildKey);
    return result;
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
