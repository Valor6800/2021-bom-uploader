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

describe('PartService.previewParts', () => {
  function makeBomService(report) {
    return {
      getBOMReport: jest.fn().mockResolvedValue(report),
      compareBOMWithJira: jest.fn().mockReturnValue({ matched: [], unmatched: report.parts }),
    };
  }

  it('passes the Assembly season parsed from its Jira summary to the BOM parser', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { summary: 'VF27A-0000A Test Assembly' } }),
    });
    const bomService = makeBomService({ parts: [], unidentified: [] });
    const service = new PartService({ jiraClient, bomService });

    await service.previewParts({ epicKey: 'HAR-2030', documentId: 'd', workspaceId: 'w', elementId: 'e' });

    expect(jiraClient.getIssue).toHaveBeenCalledWith('HAR-2030', { fields: ['summary'] });
    expect(bomService.getBOMReport).toHaveBeenCalledWith(
      'HAR-2030', 'd', 'w', 'e', { seasonType: 'F', year: '27' },
    );
  });

  it('passes a null season when the Assembly summary has no prefix', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { summary: 'Test Assembly' } }),
    });
    const bomService = makeBomService({ parts: [], unidentified: [] });
    const service = new PartService({ jiraClient, bomService });

    await service.previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });

    expect(bomService.getBOMReport.mock.calls[0][4]).toBeNull();
  });

  it('returns unidentified BOM rows alongside new and existing parts', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ fields: { summary: 'VF27A-0000A Test Assembly' } }),
    });
    const part = { fullPartNumber: 'VF27P-0001A', name: 'Test Part', quantity: 1 };
    const missing = { name: 'Bracket', partNumber: '0002', problems: ['missing Revision'] };
    const bomService = makeBomService({ parts: [part], unidentified: [missing] });
    const service = new PartService({ jiraClient, bomService });

    const preview = await service.previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });

    expect(preview.newParts).toEqual([part]);
    expect(preview.existingParts).toEqual([]);
    expect(preview.unidentified).toEqual([missing]);
  });
});
