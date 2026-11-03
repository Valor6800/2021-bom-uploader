/**
 * Unit tests for JiraClient.
 * Mocks the jira.js Version2Client to verify pagination, error wrapping,
 * and retry behaviour.
 */

import { jest } from '@jest/globals';
import { withoutEnv } from '../mocks/withoutEnv.js';

// ---------------------------------------------------------------------------
// Mock jira.js before importing JiraClient
// ---------------------------------------------------------------------------

const mockSearchForIssuesUsingJql = jest.fn();
const mockCreateIssue = jest.fn();
const mockEditIssue = jest.fn();
const mockGetIssue = jest.fn();
const mockCreateIssueLink = jest.fn();
const mockSendRequest = jest.fn();
const mockAddAttachment = jest.fn();
const mockDeleteIssueLink = jest.fn();

jest.unstable_mockModule('jira.js', () => ({
  Version2Client: class {
    constructor() {
      this.issueSearch = { searchForIssuesUsingJql: mockSearchForIssuesUsingJql };
      this.issues = {
        createIssue: mockCreateIssue,
        editIssue: mockEditIssue,
        getIssue: mockGetIssue,
      };
      // jira.js's real method is linkIssues; there is no createIssueLink.
      this.issueLinks = { linkIssues: mockCreateIssueLink, deleteIssueLink: mockDeleteIssueLink };
      this.issueAttachments = { addAttachment: mockAddAttachment };
      this.sendRequest = mockSendRequest;
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
      withoutEnv(['JIRA_URL', 'JIRA_BASE_URL'], () => {
        expect(() => new JiraClient({ bearerToken: 'tok' })).toThrow('Jira host URL is required');
      });
    });

    it('throws when token is missing', () => {
      withoutEnv(['JIRA_KEY'], () => {
        expect(() => new JiraClient({ host: 'https://jira.test' })).toThrow('Jira bearer token is required');
      });
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

  describe('non-HTTP errors', () => {
    it('re-throws a TypeError from our own code unchanged, not as a tracker error', async () => {
      const client = makeClient();
      const bug = new TypeError('this.client.issueLinks.createIssueLink is not a function');
      mockCreateIssueLink.mockRejectedValue(bug);

      await expect(client.createIssueLink('Used In', 'VAL-2', 'VAL-1')).rejects.toBe(bug);
      expect(mockCreateIssueLink).toHaveBeenCalledTimes(1);
    });

    it('wraps a real network failure (no response) as JiraApiError status 0', async () => {
      // jira.js re-throws an axios error with no response as-is.
      const { BaseClient } = await import('jira.js/out/clients/baseClient.js');
      const axiosErr = Object.assign(new Error('getaddrinfo ENOTFOUND jira.test'), {
        isAxiosError: true, code: 'ENOTFOUND',
      });
      const thrown = new BaseClient({ host: 'https://jira.test' }).buildErrorHandlingResponse(axiosErr);
      const client = makeClient();
      mockGetIssue.mockRejectedValue(thrown);

      const err = await client.getIssue('VAL-1').catch((e) => e);
      expect(err).toBeInstanceOf(JiraApiError);
      expect(err.status).toBe(0);
    });

    it("keeps Jira's error body from the HttpException jira.js really throws", async () => {
      const { BaseClient } = await import('jira.js/out/clients/baseClient.js');
      const data = {
        errorMessages: [],
        errors: { customfield_10500: "Field 'customfield_10500' cannot be set. It is not on the appropriate screen" },
      };
      const axiosErr = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true, code: 'ERR_BAD_REQUEST', response: { status: 400, statusText: 'Bad Request', data },
      });
      const thrown = new BaseClient({ host: 'https://jira.test' }).buildErrorHandlingResponse(axiosErr);
      const client = makeClient();
      mockEditIssue.mockRejectedValue(thrown);

      const err = await client.updateIssue('VAL-1', { customfield_10500: 'B' }).catch((e) => e);
      expect(err).toBeInstanceOf(JiraApiError);
      expect(err.status).toBe(400);
      expect(err.jiraErrors).toEqual({ errorMessages: [], errors: data.errors });
    });
  });

  describe('createIssueLink', () => {
    it('sends the source (outward phrase) as inwardIssue', async () => {
      // "Build VAL-200 uses Part VAL-100". Jira's POST /issueLink shows the
      // outward phrase on `inwardIssue` (checked live, link 16601).
      const client = makeClient();
      mockCreateIssueLink.mockResolvedValueOnce({});

      await client.createIssueLink('Used In', 'VAL-200', 'VAL-100');

      expect(mockCreateIssueLink).toHaveBeenCalledWith({
        type: { name: 'Used In' },
        inwardIssue: { key: 'VAL-200' },
        outwardIssue: { key: 'VAL-100' },
      });
    });

    it('matches the request body real jira.js linkIssues sends', async () => {
      // Guards the body shape above against the library itself.
      const { IssueLinks } = await import('jira.js/out/version2/issueLinks.js');
      const sendRequest = jest.fn().mockResolvedValue(undefined);
      await new IssueLinks({ sendRequest }).linkIssues({
        type: { name: 'Used In' }, inwardIssue: { key: 'VAL-200' }, outwardIssue: { key: 'VAL-100' },
      });
      expect(sendRequest.mock.calls[0][0]).toMatchObject({
        url: '/rest/api/2/issueLink',
        method: 'POST',
        data: { type: { name: 'Used In' }, inwardIssue: { key: 'VAL-200' }, outwardIssue: { key: 'VAL-100' } },
      });
    });

    it('wraps a failure as JiraApiError', async () => {
      const client = makeClient();
      const err = new Error('Bad request');
      err.status = 400;
      mockCreateIssueLink.mockRejectedValue(err);

      await expect(client.createIssueLink('Revises', 'VAL-2', 'VAL-1'))
        .rejects.toThrow(JiraApiError);
    });

    it('calls a method that really exists on jira.js IssueLinks', async () => {
      // Guards the mock above: it once stubbed a createIssueLink method the
      // library doesn't have, so every real link failed while tests passed.
      const { IssueLinks } = await import('jira.js/out/version2/issueLinks.js');
      expect(typeof IssueLinks.prototype.linkIssues).toBe('function');
      expect(IssueLinks.prototype.createIssueLink).toBeUndefined();
    });
  });

  describe('attachments', () => {
    it('reads an attachment from its content link, on the same host', async () => {
      mockSendRequest.mockResolvedValueOnce(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer);
      const bytes = await makeClient().getAttachmentContent('https://jira.test/secure/attachment/13501/VR27P-1101A.png');
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect(mockSendRequest).toHaveBeenCalledWith({
        url: '/secure/attachment/13501/VR27P-1101A.png', method: 'GET', responseType: 'arraybuffer',
      });
    });

    it('refuses a link that is not an attachment', async () => {
      await expect(makeClient().getAttachmentContent('https://jira.test/rest/api/2/issue/HAR-1')).rejects.toThrow('Not an attachment link');
      expect(mockSendRequest).not.toHaveBeenCalled();
    });

    it('adds a file to an issue, from a Buffer or text', async () => {
      mockAddAttachment.mockResolvedValue([]);
      const client = makeClient();
      await client.addAttachment('HAR-9', 'a.png', Buffer.from('PNG'));
      await client.addAttachment('HAR-9', 'a.dxf', 'ENTITIES');
      expect(mockAddAttachment.mock.calls[0][0]).toEqual({ issueIdOrKey: 'HAR-9', attachment: { filename: 'a.png', file: Buffer.from('PNG') } });
      expect(Buffer.isBuffer(mockAddAttachment.mock.calls[1][0].attachment.file)).toBe(true);
    });

    it('deletes an issue link by id', async () => {
      mockDeleteIssueLink.mockResolvedValue(undefined);
      await makeClient().deleteIssueLink(777);
      expect(mockDeleteIssueLink).toHaveBeenCalledWith({ linkId: '777' });
    });
  });
});
