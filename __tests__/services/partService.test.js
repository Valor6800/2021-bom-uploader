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

    expect(result).toMatchObject({ key: 'VAL-99', fullPartNumber: 'VR26P-0002A Side Plate' });
    expect(result.part).toMatchObject({ key: 'VAL-99', fullPartNumber: 'VR26P-0002A', epic: 'VAL-1', quantity: 2 });
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
  // The season read asks for `summary`; the chain check asks for `issuetype`.
  function assemblyIssue(summary) {
    return jest.fn().mockImplementation((key, { fields }) => Promise.resolve(
      fields.includes('issuetype') ? { fields: { issuetype: { name: 'Epic' } } } : { fields: { summary } },
    ));
  }

  function makeBomService(report) {
    return {
      getBOMReport: jest.fn().mockResolvedValue(report),
      compareBOMWithJira: jest.fn().mockReturnValue({ matched: [], unmatched: report.parts }),
    };
  }

  it('passes the Assembly season parsed from its Jira summary to the BOM parser', async () => {
    const jiraClient = makeJiraClient({
      getIssue: assemblyIssue('VF27A-0000A Test Assembly'),
    });
    const bomService = makeBomService({ parts: [], unidentified: [] });
    const service = new PartService({ jiraClient, bomService });

    await service.previewParts({ epicKey: 'HAR-2030', documentId: 'd', workspaceId: 'w', elementId: 'e' });

    expect(jiraClient.getIssue).toHaveBeenCalledWith('HAR-2030', { fields: ['summary'] });
    expect(bomService.getBOMReport).toHaveBeenCalledWith(
      'HAR-2030', 'd', 'w', 'e', { seasonType: 'F', year: '27' }, { fresh: false },
    );
  });

  it('passes a null season when the Assembly summary has no prefix', async () => {
    const jiraClient = makeJiraClient({
      getIssue: assemblyIssue('Test Assembly'),
    });
    const bomService = makeBomService({ parts: [], unidentified: [] });
    const service = new PartService({ jiraClient, bomService });

    await service.previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });

    expect(bomService.getBOMReport.mock.calls[0][4]).toBeNull();
  });

  it('returns unidentified BOM rows alongside new and existing parts', async () => {
    const jiraClient = makeJiraClient({
      getIssue: assemblyIssue('VF27A-0000A Test Assembly'),
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
    await service.createStory({ ...base, summary: 'VR26P-0001 X' });
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
    // The season read fails; the chain check (by key) still answers.
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockImplementation((key, { fields }) => (fields.includes('issuetype')
        ? Promise.resolve({ fields: { issuetype: { name: 'Epic' } } })
        : Promise.reject(err))),
    });
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

// ---------------------------------------------------------------------------
// INC-4: chain reads, partFromWritten, clone allocation, None clearing
// ---------------------------------------------------------------------------

const { partFromWritten } = await import('../../src/server/services/partService.js');

describe('PartService.getStoriesByEpics', () => {
  it('queries the Epic Link list and returns [] without a call for []', async () => {
    const jiraClient = makeJiraClient();
    const service = new PartService({ jiraClient });
    await expect(service.getStoriesByEpics([])).resolves.toEqual([]);
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
    await service.getStoriesByEpics(['HAR-B', 'HAR-A']);
    expect(jiraClient.searchIssues.mock.calls[0][0]).toContain('"Epic Link" in (HAR-B, HAR-A)');
  });

  it('refuses more than 50 keys with a 500', async () => {
    const service = new PartService({ jiraClient: makeJiraClient() });
    const keys = Array.from({ length: 51 }, (_, i) => `HAR-${i}`);
    await expect(service.getStoriesByEpics(keys)).rejects.toMatchObject({ status: 500 });
  });
});

describe('PartService.getStoriesForChain', () => {
  function chainIssue(name) {
    return jest.fn().mockResolvedValue({ fields: { issuetype: { name } } });
  }

  it('reads the chain and keeps the newest Revision\'s copy of a number', async () => {
    const jiraClient = makeJiraClient({
      getIssue: chainIssue('Epic'),
      searchIssues: jest.fn().mockResolvedValue([
        { ...partIssue('HAR-10', 'VF27P-0002A'), fields: { ...partIssue('HAR-10', 'VF27P-0002A').fields, customfield_10110: 'HAR-A' } },
        { ...partIssue('HAR-20', 'VF27P-0002A'), fields: { ...partIssue('HAR-20', 'VF27P-0002A').fields, customfield_10110: 'HAR-B' } },
      ]),
    });
    const revisionService = { getRevisionChain: jest.fn().mockResolvedValue(['HAR-B', 'HAR-A']) };
    const service = new PartService({ jiraClient, revisionService });
    const { chain, stories } = await service.getStoriesForChain('HAR-B');
    expect(chain).toEqual(['HAR-B', 'HAR-A']);
    expect(stories.map((s) => s.key)).toEqual(['HAR-20']);
  });

  it('uses [key] as the chain without revisionService', async () => {
    const jiraClient = makeJiraClient({ getIssue: chainIssue('Epic') });
    const { chain } = await new PartService({ jiraClient }).getStoriesForChain('HAR-1');
    expect(chain).toEqual(['HAR-1']);
    expect(jiraClient.searchIssues.mock.calls[0][0]).toContain('"Epic Link" in (HAR-1)');
  });

  it('refuses a Part key with 400 before any Epic Link query', async () => {
    const jiraClient = makeJiraClient({ getIssue: chainIssue('Part') });
    await expect(new PartService({ jiraClient }).getStoriesForChain('HAR-2031'))
      .rejects.toMatchObject({ status: 400, message: '"HAR-2031" is not an Assembly' });
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
  });

  it('turns a 404 into "No Assembly … found"', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 404 })),
    });
    await expect(new PartService({ jiraClient }).getStoriesForChain('HAR-9'))
      .rejects.toMatchObject({ status: 404, message: 'No Assembly HAR-9 found' });
  });
});

describe('PartService.previewParts across the chain', () => {
  it('puts a CAD row whose number belongs to a Revision A Part in existingParts', async () => {
    const { BOMService } = await import('../../src/server/services/bomService.js');
    const bomService = new BOMService({ onshapeClient: {} });
    const row = { fullPartNumber: 'VF27P-0002A', quantity: 2, material: 'AL 6061', machinery: 'CNC Mill', powdercoat: 'None', thickness: 'None' };
    jest.spyOn(bomService, 'getBOMReport').mockResolvedValue({ parts: [row], unidentified: [] });
    const revisionA = partIssue('HAR-10', 'VF27P-0002A'); // Epic Link VAL-1 = Revision A
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockImplementation((key, { fields }) => Promise.resolve(fields.includes('issuetype')
        ? { fields: { issuetype: { name: 'Epic' } } } : { fields: { summary: 'VF27A-0000B Asm' } })),
      searchIssues: jest.fn().mockResolvedValue([revisionA]),
    });
    const revisionService = { getRevisionChain: jest.fn().mockResolvedValue(['VAL-2', 'VAL-1']) };
    const service = new PartService({ jiraClient, bomService, revisionService });
    const preview = await service.previewParts({ epicKey: 'VAL-2', documentId: 'd', workspaceId: 'w', elementId: 'e', fresh: true });
    expect(preview.newParts).toEqual([]);
    expect(preview.existingParts.map((m) => m.story.key)).toEqual(['HAR-10']);
    expect(bomService.getBOMReport.mock.calls[0][5]).toEqual({ fresh: true });
  });
});

describe('partFromWritten', () => {
  it('matches _parseStories over the fields clonePart writes, plus revision', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn()
        .mockResolvedValueOnce([partIssue('VAL-50', 'VR26P-0001A')])
        .mockResolvedValueOnce([]),
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-99' }),
    });
    const service = new PartService({ jiraClient });
    await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    const [fields] = jiraClient.createIssue.mock.calls[0];
    const parsed = service._parseStories([{ key: 'VAL-99', fields }])[0];
    expect(partFromWritten('VAL-99', fields.summary, fields)).toEqual({ ...parsed, revision: 'A' });
  });

  it('gives None for an omitted Powdercoat and Thickness', () => {
    const part = partFromWritten('HAR-1', 'VF27P-0001A Plate', {});
    expect(part).toMatchObject({ powdercoat: 'None', thickness: 'None', material: 'None', machinery: 'None', quantity: 0, epic: null, revision: null });
  });
});

describe('PartService.clonePart allocation (INC-4)', () => {
  function cloneClient(max = 'VR26P-0006A') {
    let next = 99;
    return makeJiraClient({
      searchIssues: jest.fn().mockImplementation(async (jql) => (jql.includes('key in')
        ? [partIssue('VAL-50', 'VR26P-0001A')]
        : [partIssue('VAL-60', max)])),
      createIssue: jest.fn().mockImplementation(async () => ({ key: `VAL-${next++}` })),
      getIssue: jest.fn(),
    });
  }

  it('returns the Part object and makes no read after the create', async () => {
    const jiraClient = cloneClient();
    const service = new PartService({ jiraClient });
    const result = await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    expect(result.part).toMatchObject({ key: 'VAL-99', fullPartNumber: 'VR26P-0007A', epic: 'VAL-1', quantity: 2 });
    expect(jiraClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(jiraClient.getIssue).not.toHaveBeenCalled();
  });

  it('two sequential clones with the same search max get 0007 and 0008', async () => {
    const service = new PartService({ jiraClient: cloneClient() });
    const a = await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    const b = await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    expect([a.part.partNumber, b.part.partNumber]).toEqual(['0007', '0008']);
  });

  it('two concurrent clones get different numbers', async () => {
    const service = new PartService({ jiraClient: cloneClient() });
    const results = await Promise.all([
      service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' }),
      service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' }),
    ]);
    expect(results.map((r) => r.part.partNumber).sort()).toEqual(['0007', '0008']);
  });

  it('a createStory of VR26P-0008A raises the floor so the next clone gets 0009', async () => {
    const jiraClient = cloneClient('VR26P-0007A');
    const service = new PartService({ jiraClient });
    await service.createStory({ summary: 'VR26P-0008A Spacer', epic: 'VAL-1', material: 'PLA', machinery: '3D Printer', quantity: 1 });
    const result = await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    expect(result.part.partNumber).toBe('0009');
  });

  it('a createStory whose summary is not a Part leaves the floor unchanged', async () => {
    const jiraClient = cloneClient('VR26P-0007A');
    const service = new PartService({ jiraClient });
    await service.createStory({ summary: 'VR26P-0050 Legacy', epic: 'VAL-1', material: 'PLA', machinery: '3D Printer', quantity: 1 });
    const result = await service.clonePart({ sourceKey: 'VAL-50', epicKey: 'VAL-1' });
    expect(result.part.partNumber).toBe('0008');
  });
});

describe('PartService.updateStory clears Powdercoat and Thickness on None (B2)', () => {
  const base = { summary: 'VF27P-0001A Plate', material: 'AL 6061', machinery: 'CNC Mill', quantity: 1 };

  it('sends null for None', async () => {
    const jiraClient = makeJiraClient({ updateIssue: jest.fn().mockResolvedValue(undefined) });
    await new PartService({ jiraClient }).updateStory('HAR-1', { ...base, powdercoat: 'None', thickness: 'None' });
    expect(jiraClient.updateIssue.mock.calls[0][1]).toMatchObject({ customfield_10204: null, customfield_10207: null });
  });

  it('sends { value } for Black and 0.125', async () => {
    const jiraClient = makeJiraClient({ updateIssue: jest.fn().mockResolvedValue(undefined) });
    await new PartService({ jiraClient }).updateStory('HAR-1', { ...base, powdercoat: 'Black', thickness: '0.125' });
    expect(jiraClient.updateIssue.mock.calls[0][1]).toMatchObject({
      customfield_10204: { value: 'Black' }, customfield_10207: { value: '0.125' },
    });
  });

  it('a create with None omits both', async () => {
    const jiraClient = makeJiraClient({ createIssue: jest.fn().mockResolvedValue({ key: 'HAR-2' }) });
    await new PartService({ jiraClient }).createStory({ ...base, epic: 'HAR-1', powdercoat: 'None', thickness: 'None' });
    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields).not.toHaveProperty('customfield_10204');
    expect(fields).not.toHaveProperty('customfield_10207');
  });
});
