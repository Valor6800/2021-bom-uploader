/**
 * Jira Client — thin wrapper around the jira.js Version2Client.
 *
 * Provides a simplified, domain-specific interface for ValorBOM's Jira
 * operations with built-in pagination, typed error wrapping, and
 * exponential-backoff retry for transient failures.
 */

import { Version2Client } from 'jira.js';

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

export class JiraApiError extends Error {
  /**
   * @param {string} message  Human-readable description
   * @param {number} status   HTTP status code (0 for network errors)
   * @param {string} endpoint The Jira endpoint that failed
   */
  constructor(message, status, endpoint) {
    super(message);
    this.name = 'JiraApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 50;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Returns true when the error looks transient (5xx or network timeout).
 */
function isTransient(err) {
  const status = err?.status ?? err?.response?.status ?? 0;
  if (status >= 500) return true;
  const code = err?.code ?? '';
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET';
}

/**
 * Sleep helper for backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a usable HTTP status from various jira.js error shapes.
 */
function extractStatus(err) {
  return err?.status ?? err?.response?.status ?? 0;
}

/**
 * Wrap any error thrown by jira.js into a JiraApiError.
 */
function wrapError(err, endpoint) {
  const status = extractStatus(err);
  const msg = err?.message ?? String(err);
  return new JiraApiError(msg, status, endpoint);
}

// ---------------------------------------------------------------------------
// JiraClient
// ---------------------------------------------------------------------------

export class JiraClient {
  /**
   * @param {object} [options]
   * @param {string} [options.host]    Jira base URL (defaults to JIRA_URL env)
   * @param {string} [options.bearerToken] Bearer token (defaults to JIRA_KEY env)
   */
  constructor(options = {}) {
    const host = options.host ?? process.env.JIRA_URL ?? process.env.JIRA_BASE_URL;
    const token = options.bearerToken ?? process.env.JIRA_KEY;

    if (!host) throw new Error('Jira host URL is required (set JIRA_URL env var)');
    if (!token) throw new Error('Jira bearer token is required (set JIRA_KEY env var)');

    this.client = new Version2Client({
      host,
      authentication: { personalAccessToken: token },
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Search for issues using JQL with automatic pagination.
   *
   * @param {string} jql
   * @param {object} [options]
   * @param {boolean} [options.paginate=true]  Fetch all pages
   * @param {number}  [options.maxResults]     Per-page size
   * @returns {Promise<object[]>} All matching issues
   */
  async searchIssues(jql, options = {}) {
    const paginate = options.paginate !== false;
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const endpoint = `issueSearch.searchForIssuesUsingJql(jql=${jql})`;

    if (!paginate) {
      return this._retry(async () => {
        const res = await this.client.issueSearch.searchForIssuesUsingJql({
          jql,
          maxResults,
        });
        return res.issues ?? [];
      }, endpoint);
    }

    // Paginated fetch — collect all pages
    const allIssues = [];
    let startAt = 0;
    let total = Infinity;

    while (startAt < total) {
      const res = await this._retry(async () => {
        return this.client.issueSearch.searchForIssuesUsingJql({
          jql,
          startAt,
          maxResults,
        });
      }, endpoint);

      const issues = res.issues ?? [];
      allIssues.push(...issues);
      total = res.total ?? 0;
      startAt += maxResults;
    }

    return allIssues;
  }

  /**
   * Create a Jira issue.
   *
   * @param {object} fields  Issue fields payload
   * @returns {Promise<{ key: string }>}
   */
  async createIssue(fields) {
    const endpoint = 'issues.createIssue';
    return this._retry(async () => {
      const res = await this.client.issues.createIssue({ fields });
      return { key: res.key };
    }, endpoint);
  }

  /**
   * Update an existing Jira issue.
   *
   * @param {string} key     Issue key (e.g. "VAL-123")
   * @param {object} fields  Fields to update
   * @returns {Promise<void>}
   */
  async updateIssue(key, fields) {
    const endpoint = `issues.editIssue(${key})`;
    return this._retry(async () => {
      await this.client.issues.editIssue({ issueIdOrKey: key, fields });
    }, endpoint);
  }

  /**
   * Get a single issue by key.
   *
   * @param {string} key  Issue key
   * @returns {Promise<object>}
   */
  async getIssue(key) {
    const endpoint = `issues.getIssue(${key})`;
    return this._retry(async () => {
      return this.client.issues.getIssue({ issueIdOrKey: key });
    }, endpoint);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Execute `fn` with exponential-backoff retry for transient errors.
   * 4xx errors are surfaced immediately without retry.
   */
  async _retry(fn, endpoint) {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        // 4xx → surface immediately
        const status = extractStatus(err);
        if (status >= 400 && status < 500) {
          throw wrapError(err, endpoint);
        }

        // Non-transient → surface immediately
        if (!isTransient(err)) {
          throw wrapError(err, endpoint);
        }

        // Transient → backoff and retry (unless last attempt)
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
        }
      }
    }

    throw wrapError(lastError, endpoint);
  }
}
