/**
 * Part Numbers — the tool numbers Parts, so nobody has to.
 *
 * A number is four digits under a season prefix (`VR27` -> VR27P-1101), and
 * a Part's number sits in its Assembly's block: Assembly 1100 owns 1101 to
 * 1199, Assembly 1000 owns 1001 to 1099 (01 to 99 within the block). New
 * Parts take the lowest number in the block that is free, working around
 * every number already in use: those on Part tickets in the tracker, those
 * already on rows of the BOM, and those handed out by this server a moment
 * ago (tracker search lags writes, so it can't be trusted alone).
 */

import { applyPartMask } from '../utils/partMask.js';
import { badRequest } from '../middleware/httpError.js';
import { withKeyedLock } from '../utils/keyedLock.js';

const JIRA_PROJECT = () => process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';
const BLOCK_SIZE = 99;

export function formatNumber(n) {
  return String(n).padStart(4, '0');
}

/**
 * The first number of an Assembly's block, minus one: Assembly "1100" and
 * "1130" both give 1100, so their Parts are 1101 and up. Null when the
 * Assembly has no four-digit number.
 * @param {string|null|undefined} assemblyNumber
 * @returns {number|null}
 */
export function blockOf(assemblyNumber) {
  return /^\d{4}$/.test(assemblyNumber ?? '') ? Math.floor(Number(assemblyNumber) / 100) * 100 : null;
}

export class PartNumbers {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   */
  constructor({ jiraClient }) {
    this.jiraClient = jiraClient;
    /** prefix -> numbers this server has handed out */
    this._issued = new Map();
    this._locks = new Map();
  }

  /**
   * Numbers taken under a season prefix: Part tickets in the tracker plus
   * numbers issued by this server.
   *
   * @param {string} prefix  "VR27"
   * @returns {Promise<Set<string>>}  Four-digit numbers
   */
  async inUse(prefix) {
    const jql = `project = ${JIRA_PROJECT()} AND issuetype = Part`;
    const issues = await this.jiraClient.searchIssues(jql, { paginate: true, fields: ['summary'] });
    const taken = new Set(this._issued.get(prefix) ?? []);
    for (const issue of issues) {
      const parsed = applyPartMask(issue.fields?.summary ?? '');
      if (parsed && `V${parsed.seasonType}${parsed.year}` === prefix) taken.add(parsed.partNumber);
    }
    return taken;
  }

  /**
   * The next `count` free numbers, without reserving them. What Update from
   * CAD shows; Save decides for real (see `claim`).
   *
   * @param {string} prefix
   * @param {number} block  From `blockOf`
   * @param {number} count
   * @param {Iterable<string>} [alsoTaken]  Numbers on the BOM's own rows
   * @returns {Promise<string[]>}
   */
  async propose(prefix, block, count, alsoTaken = []) {
    const taken = await this.inUse(prefix);
    for (const n of alsoTaken) taken.add(n);
    return freeNumbers(taken, count, block);
  }

  /**
   * Take numbers for several Parts at once, one request at a time per prefix.
   * Each `preferred` number (what Update from CAD showed) is kept when it is
   * still free; the rest take the lowest free numbers.
   *
   * @param {string} prefix
   * @param {number} block  From `blockOf`
   * @param {(string|null)[]} preferred  One per Part, in order
   * @param {Iterable<string>} [alsoTaken]
   * @returns {Promise<string[]>}  Four digits each, in the same order
   */
  claim(prefix, block, preferred, alsoTaken = []) {
    return withKeyedLock(this._locks, prefix, async () => {
      const taken = await this.inUse(prefix);
      for (const n of alsoTaken) taken.add(n);
      const out = preferred.map(() => null);
      preferred.forEach((want, i) => {
        if (want && inBlock(want, block) && !taken.has(want)) {
          out[i] = want;
          taken.add(want);
        }
      });
      for (let i = 0; i < out.length; i++) {
        if (out[i]) continue;
        [out[i]] = freeNumbers(taken, 1, block);
        taken.add(out[i]);
      }
      for (const n of out) this._issuedSet(prefix).add(n);
      return out;
    });
  }

  /** Give a claimed number back (the Part it was for was never made). */
  forget(prefix, number) {
    this._issuedSet(prefix).delete(number);
  }

  _issuedSet(prefix) {
    if (!this._issued.has(prefix)) this._issued.set(prefix, new Set());
    return this._issued.get(prefix);
  }
}

function inBlock(text, block) {
  const n = Number(text);
  return n > block && n <= block + BLOCK_SIZE;
}

function freeNumbers(taken, count, block) {
  const out = [];
  for (let n = block + 1; n <= block + BLOCK_SIZE && out.length < count; n++) {
    const text = formatNumber(n);
    if (!taken.has(text)) out.push(text);
  }
  if (out.length < count) {
    throw badRequest(`Assembly ${formatNumber(block)} has used all ${BLOCK_SIZE} of its Part numbers.`);
  }
  return out;
}
