import { jest } from '@jest/globals';
import { RevisionService, nextRevisionLetter } from '../../src/server/services/revisionService.js';
import { RevisionField, LinkType } from '../../src/server/utils/buildConstants.js';

function makeJiraClient(overrides = {}) {
  return {
    getIssue: jest.fn(),
    createIssue: jest.fn().mockResolvedValue({ key: 'VAL-900' }),
    createIssueLink: jest.fn().mockResolvedValue(undefined),
    searchIssues: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/**
 * An issuelinks entry as Jira returns it on the newer ticket, the one that
 * "revises" previousKey: the other issue sits under `outwardIssue`.
 */
function revisesLinkEntry(previousKey) {
  return { type: { name: LinkType.REVISES, inward: 'is revised by', outward: 'revises' }, outwardIssue: { key: previousKey } };
}

describe('nextRevisionLetter', () => {
  it('treats a missing revision as implicit A, so the next is B', () => {
    expect(nextRevisionLetter(undefined)).toBe('B');
    expect(nextRevisionLetter(null)).toBe('B');
  });

  it('advances a given letter by one', () => {
    expect(nextRevisionLetter('A')).toBe('B');
    expect(nextRevisionLetter('B')).toBe('C');
  });

  it('is case-insensitive on input', () => {
    expect(nextRevisionLetter('a')).toBe('B');
  });

  it('throws once past Z rather than wrapping or silently truncating', () => {
    expect(() => nextRevisionLetter('Z')).toThrow();
  });

  it('refuses past Z with a 409 HttpError the student can read', () => {
    let err;
    try { nextRevisionLetter('Z'); } catch (e) { err = e; }
    expect(err).toMatchObject({
      name: 'HttpError',
      status: 409,
      message: 'This Part is already at Revision Z; no later revision letter exists.',
    });
  });

  it('refuses a value that is not a single letter with a 409', () => {
    expect(() => nextRevisionLetter('AA')).toThrow(expect.objectContaining({ name: 'HttpError', status: 409 }));
  });
});

describe('RevisionService.getRevisionChain', () => {
  it('returns just the key when it has no previous revision', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { issuelinks: [] } }),
    });
    const service = new RevisionService({ jiraClient });

    await expect(service.getRevisionChain('VAL-1B')).resolves.toEqual(['VAL-1B']);
  });

  it('walks backward through multiple revisions, newest first', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn()
        .mockResolvedValueOnce({ fields: { issuelinks: [revisesLinkEntry('VAL-1B')] } }) // VAL-1C -> B
        .mockResolvedValueOnce({ fields: { issuelinks: [revisesLinkEntry('VAL-1')] } })  // VAL-1B -> A
        .mockResolvedValueOnce({ fields: { issuelinks: [] } }),                           // VAL-1 (original)
    });
    const service = new RevisionService({ jiraClient });

    await expect(service.getRevisionChain('VAL-1C')).resolves.toEqual(['VAL-1C', 'VAL-1B', 'VAL-1']);
  });

  it('ignores a sibling Revises link in the forward direction', async () => {
    // VAL-1B has both a predecessor (VAL-1, outwardIssue: "VAL-1B revises
    // VAL-1") and a successor (VAL-1C, inwardIssue: "VAL-1B is revised by
    // VAL-1C") — only the predecessor should count.
    const jiraClient = makeJiraClient({
      getIssue: jest.fn()
        .mockResolvedValueOnce({
          fields: {
            issuelinks: [
              revisesLinkEntry('VAL-1'),
              { type: { name: LinkType.REVISES }, inwardIssue: { key: 'VAL-1C' } },
            ],
          },
        })
        .mockResolvedValueOnce({ fields: { issuelinks: [] } }),
    });
    const service = new RevisionService({ jiraClient });

    await expect(service.getRevisionChain('VAL-1B')).resolves.toEqual(['VAL-1B', 'VAL-1']);
  });

  it('stops rather than looping forever if a cycle exists', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn()
        .mockResolvedValueOnce({ fields: { issuelinks: [revisesLinkEntry('VAL-2')] } })
        .mockResolvedValueOnce({ fields: { issuelinks: [revisesLinkEntry('VAL-1')] } }),
    });
    const service = new RevisionService({ jiraClient });

    await expect(service.getRevisionChain('VAL-1')).resolves.toEqual(['VAL-1', 'VAL-2']);
  });
});

describe('RevisionService.createRevision', () => {
  it('advances the revision letter from the previous ticket and links back to it', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        fields: { [RevisionField.REVISION]: 'A', project: { key: 'VAL' } },
      }),
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-50' }),
    });
    const service = new RevisionService({ jiraClient });

    const result = await service.createRevision({
      previousKey: 'VAL-10',
      issueTypeName: 'Epic',
      summary: 'VR27A-1000B Intake',
    });

    expect(result).toEqual({ key: 'VAL-50', revision: 'B' });

    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields.issuetype).toEqual({ name: 'Epic' });
    expect(fields.project).toEqual({ key: 'VAL' });
    expect(fields[RevisionField.REVISION]).toBe('B');

    // "VAL-50 revises VAL-10": the new ticket is the link's source.
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.REVISES, 'VAL-50', 'VAL-10');
  });

  it('treats a previous ticket with no Revision field as Revision A', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { project: { key: 'VAL' } } }),
    });
    const service = new RevisionService({ jiraClient });

    const result = await service.createRevision({
      previousKey: 'VAL-10',
      issueTypeName: 'Part',
      summary: 'VR27P-3005B Bash bar',
    });

    expect(result.revision).toBe('B');
  });

  it('passes through extra fields onto the new ticket', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { project: { key: 'VAL' } } }),
    });
    const service = new RevisionService({ jiraClient });

    await service.createRevision({
      previousKey: 'VAL-10',
      issueTypeName: 'Part',
      summary: 'VR27P-3005B Bash bar',
      extraFields: { customfield_10202: { value: 'AL 6061' } },
    });

    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields.customfield_10202).toEqual({ value: 'AL 6061' });
  });
});

describe('RevisionService.createRevision Revises link failure (INC-4)', () => {
  it('rethrows the original error with key, revision and stage revises-link', async () => {
    const original = Object.assign(new Error('down'), { name: 'JiraApiError', status: 503 });
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { [RevisionField.REVISION]: 'A', project: { key: 'VAL' } } }),
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-901' }),
      createIssueLink: jest.fn().mockRejectedValue(original),
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new RevisionService({ jiraClient });
    const caught = await service.createRevision({ previousKey: 'VAL-50', issueTypeName: 'Part', summary: 'VR26P-0001B X' })
      .catch((e) => e);
    warn.mockRestore();
    expect(caught).toBe(original);
    expect(caught.status).toBe(503);
    expect(caught.details).toEqual({ key: 'VAL-901', revision: 'B', stage: 'revises-link' });
  });

  it('returns { key, revision } when the link succeeds', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { [RevisionField.REVISION]: 'A', project: { key: 'VAL' } } }),
    });
    const service = new RevisionService({ jiraClient });
    await expect(service.createRevision({ previousKey: 'VAL-50', issueTypeName: 'Part', summary: 'VR26P-0001B X' }))
      .resolves.toEqual({ key: 'VAL-900', revision: 'B' });
  });
});
