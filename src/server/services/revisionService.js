/**
 * Revision Service — manages the Revision field and the Revises link chain
 * on Assembly and Part tickets (Sheet 01/02 of the plan). A Revision is a
 * new ticket, same number, chained back to the one it replaces; this
 * service is what tells BuildService where a numbering chain actually ends.
 */

import { RevisionField, LinkType } from '../utils/buildConstants.js';
import { conflict } from '../middleware/httpError.js';
import { jiraErrorsForLog } from '../utils/upstreamError.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';

/** A-Z only — if a 27th revision ever happens, this is the place to extend it. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The next letter after the given one. Revision A -> B -> C ...
 * @param {string|null|undefined} current  Blank/missing means "A" (Sheet 02)
 * @returns {string}
 * @throws {HttpError} 409 past Z or for a value that isn't a single letter
 */
export function nextRevisionLetter(current) {
  const normalized = (current ?? 'A').toUpperCase();
  const index = ALPHABET.indexOf(normalized);
  if (index === ALPHABET.length - 1) {
    throw conflict('This Part is already at Revision Z; no later revision letter exists.');
  }
  if (index === -1) {
    throw conflict(`Revision "${current}" isn't a letter from A to Z, so no next revision letter exists.`);
  }
  return ALPHABET[index + 1];
}

export class RevisionService {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   */
  constructor({ jiraClient }) {
    this.jiraClient = jiraClient;
  }

  /**
   * Walk the Revises chain backward from a ticket to find every earlier
   * revision of it. Order is newest-first, starting with the key passed in.
   *
   * Used to build the full `revisionChainKeys` list BuildService needs for
   * continuous Build numbering.
   *
   * @param {string} key  Any revision's ticket key
   * @returns {Promise<string[]>}
   */
  async getRevisionChain(key) {
    const chain = [key];
    let current = key;

    // A chain is only ever as long as the number of revisions a ticket has
    // actually had — in practice always small — but this still guards
    // against a cycle turning into an infinite loop if one is ever created
    // by hand in Jira.
    const seen = new Set(chain);
    for (let i = 0; i < 100; i++) {
      const previous = await this._getPreviousRevision(current);
      if (!previous || seen.has(previous)) break;
      chain.push(previous);
      seen.add(previous);
      current = previous;
    }

    return chain;
  }

  /**
   * Create a new revision of an Assembly or Part ticket: a new issue of the
   * same type, same number, Revision field advanced one letter, linked back
   * to the ticket it replaces via Revises.
   *
   * Copies only the fields this plan actually depends on carrying forward
   * (summary, project) — anything else (Material, Onshape IDs, …) is the
   * caller's to set explicitly, since a revision is exactly the moment those
   * are expected to change.
   *
   * @param {object} params
   * @param {string} params.previousKey   The ticket being revised
   * @param {string} params.issueTypeName "Epic" for an Assembly, "Part" for a Part
   * @param {string} params.summary       Full summary for the new ticket,
   *   already carrying the advanced revision letter
   * @param {object} [params.extraFields] Any additional fields to set
   * @returns {Promise<{ key: string, revision: string }>}
   */
  async createRevision({ previousKey, issueTypeName, summary, extraFields = {} }) {
    const previousIssue = await this.jiraClient.getIssue(previousKey, {
      fields: [RevisionField.REVISION, 'project'],
    });
    const previousRevision = previousIssue.fields?.[RevisionField.REVISION] ?? null;
    const revision = nextRevisionLetter(previousRevision);

    const fields = {
      project: { key: previousIssue.fields?.project?.key ?? JIRA_PROJECT },
      issuetype: { name: issueTypeName },
      summary,
      [RevisionField.REVISION]: revision,
      ...extraFields,
    };

    const result = await this.jiraClient.createIssue(fields);
    try {
      // "new revises previous".
      await this.jiraClient.createIssueLink(LinkType.REVISES, result.key, previousKey);
    } catch (err) {
      // The ticket exists now; say which one, so a caller can show it and
      // refuse a second revision instead of creating another.
      console.warn('[revision]', result.key, 'created but Revises link to', previousKey,
        'failed:', err?.status, err?.message, ...jiraErrorsForLog(err));
      if (err && typeof err === 'object') {
        err.details = { ...err.details, key: result.key, revision, stage: 'revises-link' };
      }
      throw err;
    }

    return { key: result.key, revision };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * The ticket this one Revises, if any — i.e. the earlier revision, not a
   * later one. JQL's `linkedIssues()` can't filter by direction (it returns
   * both the predecessor and successor if both exist), so this reads the
   * issue's own `issuelinks` and picks the specific entry where this ticket
   * sits on the "revises" (outward) side. Jira lists that entry on this
   * ticket as `outwardIssue: <the one it replaced>`; a later revision that
   * revises this one appears as `inwardIssue` and is ignored.
   * @private
   */
  async _getPreviousRevision(key) {
    const issue = await this.jiraClient.getIssue(key, { fields: ['issuelinks'] });
    const links = issue.fields?.issuelinks ?? [];

    const revisesLink = links.find(
      (link) => link.type?.name === LinkType.REVISES && link.outwardIssue,
    );
    return revisesLink?.outwardIssue?.key ?? null;
  }
}
