/**
 * Unit tests for JiraClient.
 * Mocks the jira.js Version2Client to verify pagination, error wrapping,
 * and retry behaviour.
 */

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock jira.js before importing JiraClient
// ---------------------------------------------------------------------------

const mockSearchForIssuesUsingJql = jest.fn();
const mockCreateIssue = jest.fn();
const mockEditIssue = jest.fn();
const mockGetIssue = jest.fn();

jest.unstable_mockModule('jira.js', () => ({
  Version2Client: class {
    constructor() {
      this.issueSearch = { searchForIssuesUsingJql: mockSearchForIssuesUsingJql };
      this.issues = {
        createIssue: mockCreateIssue,
        editIssue: mockEditIssue,
        getIssue: mockGetIssue,
      };
    }
  },
}));

// Dynamic import after mock registration
const { JiraClient, JiraApiError } = await import('../../src/server/clients/jiraClient.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient() {
  return new JiraClient({ host: 'https://jira.test', bearerToken: 'tok' });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JiraClient', () => {
  describe('constructor', () => {
    it('throws when host is missing', () => {
      const origUrl = process.env.JIRA_URL;
      delete process.env.JIRA_URL;
      expect(() => new JiraClient({ bearerToken: 'tok' })).toThrow('Jira host URL is required');
      process.env.JIRA_URL = origUrl;
    });

    it('throws when token is missing', () => {
      const origKey = process.env.JIRA_KEY;
      delete process.env.JIRA_KEY;
      expect(() => new JiraClient({ host: 'https://jira.test' })).toThrow('Jira bearer token is required');
      process.env.JIRA_KEY = origKey;
    });
  });

  describe('searchIssues', () => {
    it('returns all issues from a single page', async () => {
      const client = makeClient();
      mockSearchForIssuesUsingJql.mockResolvedValueOnce({
        issues: [{ key: 'A-1' }, { key: 'A-2' }],
        total: 2,
      });

      const result = await client.searchIssues('project = TEST');
      expect(result).toEqual([{ key: 'A-1' }, { key: 'A-2' }]);
      expect(mockSearchForIssuesUsingJql).toHaveBeenCalledTimes(1);
    });

    it('paginates across multiple pages', async () => {
      const client = makeClient();
      mockSearchForIssuesUsingJql
        .mockResolvedValueOnce({ issues: [{ key: 'A-1' }], total: 3 })
        .mockResolvedValueOnce({ issues: [{ key: 'A-2' }], total: 3 })
        .mockResolvedValueOnce({ issues: [{ key: 'A-3' }], total: 3 });

      const result = await client.searchIssues('project = TEST', { maxResults: 1 });
      expect(result).toHaveLength(3);
      expect(mockSearchForIssuesUsingJql).toHaveBeenCalledTimes(3);
    });

    it('skips pagination when paginate=false', async () => {
      const client = makeClient();
      mockSearchForIssuesUsingJql.mockResolvedValueOnce({
        issues: [{ key: 'A-1' }],
        total: 100,
      });

      const result = await client.searchIssues('project = TEST', { paginate: false });
      expect(result).toEqual([{ key: 'A-1' }]);
      expect(mockSearchForIssuesUsingJql).toHaveBeenCalledTimes(1);
    });
  });

  describe('createIssue', () => {
    it('returns the created issue key', async () => {
      const client = makeClient();
      mockCreateIssue.mockResolvedValueOnce({ key: 'VAL-99' });

      const result = await client.createIssue({ summary: 'test' });
      expect(result).toEqual({ key: 'VAL-99' });
    });
  });

  describe('updateIssue', () => {
    it('calls editIssue with correct params', async () => {
      const client = makeClient();
      mockEditIssue.mockResolvedValueOnce(undefined);

      await client.updateIssue('VAL-1', { summary: 'updated' });
      expect(mockEditIssue).toHaveBeenCalledWith({
        issueIdOrKey: 'VAL-1',
        fields: { summary: 'updated' },
      });
    });
  });

  describe('getIssue', () => {
    it('returns the full issue', async () => {
      const client = makeClient();
      const issue = { key: 'VAL-1', fields: { summary: 'test' } };
      mockGetIssue.mockResolvedValueOnce(issue);

      const result = await client.getIssue('VAL-1');
      expect(result).toEqual(issue);
    });
  });

  describe('error handling', () => {
    it('wraps 4xx errors as JiraApiError without retry', async () => {
      const client = makeClient();
      const err = new Error('Not found');
      err.status = 404;
      mockSearchForIssuesUsingJql.mockRejectedValue(err);

      await expect(client.searchIssues('bad jql')).rejects.toThrow(JiraApiError);
      // Should only be called once — no retry for 4xx
      expect(mockSearchForIssuesUsingJql).toHaveBeenCalledTimes(1);
    });

    it('retries transient 5xx errors', async () => {
      const client = makeClient();
      const err = new Error('Server error');
      err.status = 503;
      mockSearchForIssuesUsingJql
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ issues: [{ key: 'A-1' }], total: 1 });

      const result = await client.searchIssues('project = TEST');
      expect(result).toEqual([{ key: 'A-1' }]);
      // First call fails, second succeeds
      expect(mockSearchForIssuesUsingJql).toHaveBeenCalledTimes(2);
    });

    it('surfaces error after exhausting retries', async () => {
      const client = makeClient();
      const err = new Error('Server error');
      err.status = 500;
      mockSearchForIssuesUsingJql.mockRejectedValue(err);

      await expect(client.searchIssues('project = TEST')).rejects.toThrow(JiraApiError);
      // 1 initial + 3 retries = 4 total
      expect(mockSearchForIssuesUsingJql).toHaveBeenCalledTimes(4);
    });

    it('JiraApiError contains status and endpoint', async () => {
      const client = makeClient();
      const err = new Error('Bad request');
      err.status = 400;
      mockCreateIssue.mockRejectedValue(err);

      try {
        await client.createIssue({ summary: 'test' });
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(JiraApiError);
        expect(e.status).toBe(400);
        expect(e.endpoint).toContain('createIssue');
      }
    });
  });
});
