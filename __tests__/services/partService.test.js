import { jest } from '@jest/globals';
import { PartService } from '../../src/server/services/partService.js';

function makeJiraClient(overrides = {}) {
  return {
    searchIssues: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function partIssue(key, partNumber) {
  return {
    key,
    fields: {
      summary: `${partNumber} Side Plate`,
      customfield_10110: 'VAL-1',
      customfield_10201: [{ value: 'CNC Mill' }],
      customfield_10202: { value: 'AL 6061' },
      customfield_10206: 2,
    },
  };
}

describe('PartService.getNextPartNumber', () => {
  it('returns 0001 when the season has no Parts yet', async () => {
    const jiraClient = makeJiraClient();
    const service = new PartService({ jiraClient });

    const result = await service.getNextPartNumber('R', '26');

    expect(result).toBe('0001');
    const [jql] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toContain('summary ~ "VR26P-*"');
  });

  it('returns one past the highest existing number in the season', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        partIssue('VAL-50', 'VR26P-0001A'),
        partIssue('VAL-51', 'VR26P-0007A'),
        partIssue('VAL-52', 'VR26P-0003A'),
      ]),
    });
    const service = new PartService({ jiraClient });

    const result = await service.getNextPartNumber('R', '26');

    expect(result).toBe('0008');
  });
});

describe('PartService.clonePart', () => {
  it('allocates the next number and copies the source Part\'s BOM fields', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn()
        .mockResolvedValueOnce([partIssue('VAL-50', 'VR26P-0001A')]) // getStoriesByKeys([sourceKey])
        .mockResolvedValueOnce([partIssue('VAL-50', 'VR26P-0001A')]), // getNextPartNumber
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-99' }),
    });
    const service = new PartService({ jiraClient });

    const result = await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });

    expect(result).toEqual({ key: 'VAL-99', fullPartNumber: 'VR26P-0002A Side Plate' });
    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields).toMatchObject({
      summary: 'VR26P-0002A Side Plate',
      customfield_10110: 'VAL-1',
      customfield_10206: 2,
      customfield_10202: { value: 'AL 6061' },
    });
  });

  it('throws when the source key is not a Part', async () => {
    const jiraClient = makeJiraClient();
    const service = new PartService({ jiraClient });

    await expect(service.clonePart({ sourceKey: 'VAL-999', epicKey: 'VAL-1' }))
      .rejects.toThrow('is not a Part');
  });
});

describe('PartService.getStoriesByKeys', () => {
  it('returns an empty array without querying when no keys are given', async () => {
    const jiraClient = makeJiraClient();
    const service = new PartService({ jiraClient });

    const result = await service.getStoriesByKeys([]);

    expect(result).toEqual([]);
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
  });

  it('builds a JQL "key in (...)" clause and parses the results', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        partIssue('VAL-50', 'VR26P-0001A'),
        partIssue('VAL-51', 'VR26P-0002A'),
      ]),
    });
    const service = new PartService({ jiraClient });

    const result = await service.getStoriesByKeys(['VAL-50', 'VAL-51']);

    expect(result).toEqual([
      expect.objectContaining({ key: 'VAL-50', fullPartNumber: 'VR26P-0001A' }),
      expect.objectContaining({ key: 'VAL-51', fullPartNumber: 'VR26P-0002A' }),
    ]);
    const [jql] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toContain('key in (VAL-50, VAL-51)');
  });
});
