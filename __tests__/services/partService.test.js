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
describe('PartService Revision on create (B1)', () => {
  const base = {
    epic: 'HAR-2030', material: 'AL 6061', machinery: 'CNC Mill', quantity: 1,
  };
  function setup() {
    const jiraClient = makeJiraClient({ createIssue: jest.fn().mockResolvedValue({ key: 'HAR-3000' }) });
    return { jiraClient, service: new PartService({ jiraClient }) };
  }
  it('writes the Revision given in the payload', async () => {
    const { jiraClient, service } = setup();
    await service.createStory({ ...base, summary: 'VF27P-0001C Plate', revision: 'C' });
    expect(jiraClient.createIssue.mock.calls[0][0].customfield_10500).toBe('C');
  });
  it('takes the Revision from the summary letter when the payload has none', async () => {
    const { jiraClient, service } = setup();
    await service.createStory({ ...base, summary: 'VF27P-0001C Plate' });
    expect(jiraClient.createIssue.mock.calls[0][0].customfield_10500).toBe('C');
  });
  it('defaults the Revision to A when the summary has no letter', async () => {
    const { jiraClient, service } = setup();
    await service.uploadSelected([{ ...base, summary: 'VR26P-0001 X' }]);
    expect(jiraClient.createIssue.mock.calls[0][0].customfield_10500).toBe('A');
  });
  it('rejects a Revision that is not one capital letter with status 400', async () => {
    const { jiraClient, service } = setup();
    await expect(service.createStory({ ...base, summary: 'VF27P-0001A Plate', revision: 'AA' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^Validation failed: /) });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });
  it('rejects an invalid material with status 400', async () => {
    const { service } = setup();
    await expect(service.createStory({ ...base, summary: 'VF27P-0001A Plate', material: 'Steel' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^Validation failed: /) });
  });
  it('clonePart writes Revision A', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn()
        .mockResolvedValueOnce([partIssue('VAL-50', 'VR26P-0001C')])
        .mockResolvedValueOnce([partIssue('VAL-50', 'VR26P-0001C')]),
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-99' }),
    });
    const service = new PartService({ jiraClient });
    await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    expect(jiraClient.createIssue.mock.calls[0][0].customfield_10500).toBe('A');
  });
  it('updateStory does not write the Revision', async () => {
    const jiraClient = makeJiraClient({ updateIssue: jest.fn().mockResolvedValue(undefined) });
    const service = new PartService({ jiraClient });
    await service.updateStory('HAR-3000', { ...base, summary: 'VF27P-0001C Plate', revision: 'C' });
    expect(jiraClient.updateIssue.mock.calls[0][1]).not.toHaveProperty('customfield_10500');
  });
});
describe('PartService never writes Build fields on a Part (B6)', () => {
  const BUILD_FIELDS = ['customfield_10501', 'customfield_10502', 'customfield_10503'];
  const payload = {
    summary: 'VF27P-0001A Plate', epic: 'HAR-2030', material: 'AL 6061', machinery: 'CNC Mill', quantity: 1,
  };
  function expectNoBuildFields(fields) {
    for (const f of BUILD_FIELDS) expect(fields).not.toHaveProperty(f);
  }
  it('createStory', async () => {
    const jiraClient = makeJiraClient({ createIssue: jest.fn().mockResolvedValue({ key: 'HAR-3000' }) });
    await new PartService({ jiraClient }).createStory(payload);
    expectNoBuildFields(jiraClient.createIssue.mock.calls[0][0]);
  });
  it('clonePart', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn()
        .mockResolvedValueOnce([partIssue('VAL-50', 'VR26P-0001A')])
        .mockResolvedValueOnce([partIssue('VAL-50', 'VR26P-0001A')]),
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-99' }),
    });
    await new PartService({ jiraClient }).clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    expectNoBuildFields(jiraClient.createIssue.mock.calls[0][0]);
  });
  it('updateStory', async () => {
    const jiraClient = makeJiraClient({ updateIssue: jest.fn().mockResolvedValue(undefined) });
    await new PartService({ jiraClient }).updateStory('HAR-3000', payload);
    expectNoBuildFields(jiraClient.updateIssue.mock.calls[0][1]);
  });
});
describe('PartService.previewParts season lookup failure (B3)', () => {
  it('resolves with a null season and still parses rows that carry their own Project', async () => {
    const { BOMService } = await import('../../src/server/services/bomService.js');
    const headers = [
      { propertyName: 'item', name: 'Item', propertyId: '5ace8269c046ad612c65a0ba' },
      { propertyName: 'quantity', name: 'Quantity', propertyId: '5ace84d3c046ad611c65a0dd' },
      { propertyName: 'partNumber', name: 'Part number', propertyId: '57f3fb8efa3416c06701d60f' },
      { propertyName: 'name', name: 'Name', propertyId: '57f3fb8efa3416c06701d60d' },
      { propertyName: 'material', name: 'Material', propertyId: '57f3fb8efa3416c06701d615' },
      { propertyName: 'revision', name: 'Revision', propertyId: '57f3fb8efa3416c06701d610' },
      { propertyName: 'project', name: 'Project', propertyId: '57f3fb8efa3416c06701d613' },
    ];
    const items = [
      { item: '1', quantity: 1, partNumber: '0001', revision: 'A', project: 'VF27', name: 'Own Project' },
      { item: '2', quantity: 1, partNumber: '0002', revision: 'A', project: '', name: 'Needs Season' },
    ];
    const onshapeClient = {
      getAssemblyBOM: jest.fn().mockResolvedValue({ bomTable: { formatVersion: '1.0', headers, items } }),
    };
    const bomService = new BOMService({ onshapeClient });
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const jiraClient = makeJiraClient({ getIssue: jest.fn().mockRejectedValue(err) });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const getBOMReport = jest.spyOn(bomService, 'getBOMReport');
    try {
      const service = new PartService({ jiraClient, bomService });
      const preview = await service.previewParts({
        epicKey: 'HAR-2030', documentId: 'd-b3', workspaceId: 'w', elementId: 'e',
      });
      expect(getBOMReport.mock.calls[0][4]).toBeNull();
      expect(preview.newParts.map((p) => p.fullPartNumber)).toEqual(['VF27P-0001A']);
      expect(preview.unidentified).toEqual([
        expect.objectContaining({ name: 'Needs Season', problems: [expect.stringMatching(/missing Project/)] }),
      ]);
      expect(warn).toHaveBeenCalledWith('[preview] season lookup for', 'HAR-2030', 'failed:', 503, 'Service Unavailable');
    } finally {
      warn.mockRestore();
    }
  });
});
