import { jest } from '@jest/globals';
import { EpicService } from '../../src/server/services/epicService.js';
import { JiraApiError } from '../../src/server/clients/jiraClient.js';

function makeJiraClient(overrides = {}) {
  return {
    getIssue: jest.fn(),
    ...overrides,
  };
}

describe('EpicService.getEpicByKey', () => {
  it('returns the Assembly shape for a numbered Assembly', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        key: 'VAL-1',
        fields: {
          summary: 'VR26A-0001 End Effector',
          issuetype: { name: 'Epic' },
          customfield_10300: 'doc1',
          customfield_10301: 'ws1',
          customfield_10302: 'el1',
        },
      }),
    });
    const service = new EpicService({ jiraClient, onshapeClient: { baseUrl: 'https://cad.onshape.com' } });

    const result = await service.getEpicByKey('VAL-1');

    expect(result).toEqual(expect.objectContaining({
      key: 'VAL-1',
      summary: 'VR26A-0001 End Effector',
      numbered: true,
      fullPartNumber: 'VR26A-0001',
      documentId: 'doc1',
      workspaceId: 'ws1',
      elementId: 'el1',
      onshapeUrl: 'https://cad.onshape.com/documents/doc1/w/ws1/e/el1',
    }));
  });

  it('parses a v3 name with a revision letter into number, revision and clean name', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        key: 'HAR-2027',
        fields: { summary: 'VF27A-0000A Test Assembly', issuetype: { name: 'Assembly' } },
      }),
    });
    const service = new EpicService({ jiraClient });

    const result = await service.getEpicByKey('HAR-2027');

    expect(result).toEqual(expect.objectContaining({
      fullPartNumber: 'VF27A-0000A',
      seasonType: 'F',
      year: '27',
      partNumber: '0000',
      revision: 'A',
      name: 'Test Assembly',
      numbered: true,
    }));
  });

  it('returns an unnumbered Assembly instead of dropping it', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        key: 'HAR-1984',
        fields: { summary: 'VF27-0200 Tooling', issuetype: { name: 'Epic' } },
      }),
    });
    const service = new EpicService({ jiraClient });

    const result = await service.getEpicByKey('HAR-1984');

    expect(result).toEqual(expect.objectContaining({
      key: 'HAR-1984',
      numbered: false,
      name: 'VF27-0200 Tooling',
      seasonLabel: 'Facility 2027',
    }));
  });

  it('returns null for a key that is not an Assembly, even if its summary parses', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        key: 'HAR-2031',
        fields: { summary: 'VF27P-0001A Bracket', issuetype: { name: 'Part' } },
      }),
    });
    const service = new EpicService({ jiraClient });

    expect(await service.getEpicByKey('HAR-2031')).toBeNull();
  });

  it('turns a tracker 404 into a 404 "No Assembly … found"', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockRejectedValue(new JiraApiError('Issue does not exist', 404, 'x')),
    });
    const service = new EpicService({ jiraClient });

    await expect(service.getEpicByKey('HAR-9')).rejects.toMatchObject({
      status: 404,
      message: 'No Assembly HAR-9 found',
    });
  });

  it('passes other tracker errors through', async () => {
    const err = new JiraApiError('down', 503, 'x');
    const service = new EpicService({ jiraClient: makeJiraClient({ getIssue: jest.fn().mockRejectedValue(err) }) });

    await expect(service.getEpicByKey('HAR-9')).rejects.toBe(err);
  });
});

describe('EpicService.searchAssemblies', () => {
  const savedProject = process.env.PROJECT_KEY;
  beforeEach(() => { process.env.PROJECT_KEY = 'HAR'; });
  afterEach(() => {
    if (savedProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = savedProject;
  });

  function issue(key, summary, { status = 'New', type = 'Epic', created = '2026-01-01T00:00:00.000+0000' } = {}) {
    return { key, fields: { summary, status: { name: status }, issuetype: { name: type }, created } };
  }
  const OPEN = [
    issue('HAR-2030', 'VF27A-0000A Test Assembly', { created: '2026-10-29T00:00:00.000+0000' }),
    issue('HAR-1984', 'VF27-0200 Tooling', { created: '2026-09-02T00:00:00.000+0000' }),
    issue('HAR-1972', 'Second end effector', { created: '2026-06-01T00:00:00.000+0000' }),
  ];
  const CLOSED = issue('HAR-1990', 'VR26A-0300A Old Climber', { status: 'Closed' });

  function makeService({ list = OPEN, direct } = {}) {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue(list),
      getIssue: direct ?? jest.fn().mockRejectedValue(new JiraApiError('Issue does not exist', 404, 'x')),
    });
    return { service: new EpicService({ jiraClient, onshapeClient: { baseUrl: 'https://cad.onshape.com' } }), jiraClient };
  }

  it('lists open Assemblies with one JQL that excludes closed ones', async () => {
    const { service, jiraClient } = makeService();

    const result = await service.searchAssemblies('');

    const [jql, options] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toMatch(/AND issuetype = Assembly AND status not in \(Closed, Finished\) ORDER BY created DESC$/);
    expect(options).toEqual(expect.objectContaining({ paginate: true, fields: expect.arrayContaining(['summary', 'status', 'created', 'issuetype', 'customfield_10500']) }));
    expect(jiraClient.getIssue).not.toHaveBeenCalled();
    expect(result.total).toBe(3);
    expect(result.groups.map((g) => g.label)).toEqual(['Facility 2027', 'Other']);
  });

  it('reads the project at call time, matching validateIssueKey', async () => {
    const { service, jiraClient } = makeService();

    await service.searchAssemblies('');

    expect(jiraClient.searchIssues.mock.calls[0][0]).toMatch(/^project = HAR AND /);
  });

  it('drops the status clause when includeClosed is true, so a closed one matches by name', async () => {
    const { service, jiraClient } = makeService({ list: [...OPEN, CLOSED] });

    const result = await service.searchAssemblies('climber', { includeClosed: true });

    expect(jiraClient.searchIssues.mock.calls[0][0]).not.toContain('status not in');
    expect(result.results).toEqual([expect.objectContaining({ key: 'HAR-1990', closed: true })]);
  });

  it('upper-cases a key-shaped query before getIssue and merges the hit by key', async () => {
    const direct = jest.fn().mockResolvedValue(OPEN[0]);
    const { service, jiraClient } = makeService({ direct });

    const result = await service.searchAssemblies('har-2030');

    expect(jiraClient.getIssue).toHaveBeenCalledWith('HAR-2030', expect.objectContaining({ fields: expect.any(Array) }));
    expect(result.total).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual(expect.objectContaining({ key: 'HAR-2030', score: 100 }));
  });

  it('ignores a 404 from the key lookup', async () => {
    const { service } = makeService();

    const result = await service.searchAssemblies('HAR-999999');

    expect(result).toEqual({ query: 'HAR-999999', total: 0, results: [], groups: null });
  });

  it('drops a key hit that is not an Assembly', async () => {
    const direct = jest.fn().mockResolvedValue(issue('HAR-2031', 'VF27P-0001A Bracket', { type: 'Part' }));
    const { service } = makeService({ direct });

    const result = await service.searchAssemblies('HAR-2031');

    expect(result.total).toBe(0);
  });

  it('finds a closed Assembly by key with includeClosed off and marks it closed', async () => {
    const direct = jest.fn().mockResolvedValue(CLOSED);
    const { service, jiraClient } = makeService({ direct });

    const result = await service.searchAssemblies('HAR-1990');

    expect(jiraClient.searchIssues.mock.calls[0][0]).toContain('status not in (Closed, Finished)');
    expect(result.total).toBe(1);
    expect(result.results[0]).toEqual(expect.objectContaining({ key: 'HAR-1990', closed: true, score: 100 }));
  });

  it('does not look up a key from another project', async () => {
    const { service, jiraClient } = makeService();

    await service.searchAssemblies('VAL-1');

    expect(jiraClient.getIssue).not.toHaveBeenCalled();
  });

  it('logs and ignores a non-404 key lookup failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const direct = jest.fn().mockRejectedValue(new JiraApiError('down', 503, 'x'));
    const { service } = makeService({ direct });

    const result = await service.searchAssemblies('HAR-2030');

    expect(result.total).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('propagates a failure of the main search', async () => {
    const err = new JiraApiError('down', 503, 'x');
    const jiraClient = makeJiraClient({ searchIssues: jest.fn().mockRejectedValue(err) });
    const service = new EpicService({ jiraClient });

    await expect(service.searchAssemblies('intake')).rejects.toBe(err);
  });

  it('counts total before the cap with 60 Assemblies and limit 50', async () => {
    const list = Array.from({ length: 60 }, (_, i) => issue(`HAR-${3000 + i}`, `VR27A-${String(i).padStart(4, '0')}A Thing ${i}`));
    const { service } = makeService({ list });

    const result = await service.searchAssemblies('', { limit: 50 });

    expect(result.total).toBe(60);
    expect(result.results).toHaveLength(50);
    expect(result.groups.flatMap((g) => g.keys)).toEqual(result.results.map((a) => a.key));
  });
});

describe('EpicService.generateEpicFromURL', () => {
  const URL = 'https://cad.onshape.com/documents/8c64dfdcb66184646a7a3f17/w/82f00d3cbea6901ac26040bd/e/faea62821490977c33bc8d7c';

  // Mirrors the live response shape of GET /api/metadata/d/{d}/w/{w}/e/{e}.
  function metadata(overrides = {}) {
    const values = {
      Name: 'Test Assembly',
      'Part number': '0000',
      Revision: 'A',
      Project: 'VF27',
      ...overrides,
    };
    const ids = {
      Name: '57f3fb8efa3416c06701d60d',
      'Part number': '57f3fb8efa3416c06701d60f',
      Revision: '57f3fb8efa3416c06701d610',
      Project: '57f3fb8efa3416c06701d613',
    };
    return {
      elementType: 1,
      mimeType: 'onshape/assembly',
      properties: [
        ...Object.entries(ids).map(([name, propertyId]) => ({
          name, propertyId, value: values[name], valueType: 'STRING',
        })),
        { name: 'Description', propertyId: '57f3fb8efa3416c06701d60e', value: null, valueType: 'STRING' },
      ],
    };
  }

  function setup(meta) {
    const jiraClient = makeJiraClient({ createIssue: jest.fn().mockResolvedValue({ key: 'HAR-1' }) });
    const onshapeClient = { getElementMetadata: jest.fn().mockResolvedValue(meta) };
    return { jiraClient, onshapeClient, service: new EpicService({ jiraClient, onshapeClient }) };
  }

  it('builds the summary and Epic Name from Project, Part number, Revision and Name', async () => {
    const { service, jiraClient, onshapeClient } = setup(metadata());

    const result = await service.generateEpicFromURL(URL);

    expect(onshapeClient.getElementMetadata).toHaveBeenCalledWith(
      '8c64dfdcb66184646a7a3f17', '82f00d3cbea6901ac26040bd', 'faea62821490977c33bc8d7c',
    );
    expect(result).toEqual({ key: 'HAR-1', summary: 'VF27A-0000A Test Assembly' });
    const fields = jiraClient.createIssue.mock.calls[0][0];
    expect(fields).toEqual(expect.objectContaining({
      summary: 'VF27A-0000A Test Assembly',
      customfield_10104: 'VF27A-0000A Test Assembly',
      customfield_10500: 'A',
      customfield_10300: '8c64dfdcb66184646a7a3f17',
      customfield_10301: '82f00d3cbea6901ac26040bd',
      customfield_10302: 'faea62821490977c33bc8d7c',
    }));
  });

  it('falls back to the property name when the property id differs', async () => {
    const meta = metadata();
    meta.properties = meta.properties.map((p) => ({ ...p, propertyId: `other-${p.propertyId}` }));
    const { service, jiraClient } = setup(meta);

    await service.generateEpicFromURL(URL);

    expect(jiraClient.createIssue.mock.calls[0][0].summary).toBe('VF27A-0000A Test Assembly');
  });

  it('trims whitespace around property values', async () => {
    const { service, jiraClient } = setup(metadata({ Project: ' VF27 ', Name: ' Test Assembly ' }));

    await service.generateEpicFromURL(URL);

    expect(jiraClient.createIssue.mock.calls[0][0].summary).toBe('VF27A-0000A Test Assembly');
  });

  it.each([
    ['Project', { Project: null }],
    ['Part number', { 'Part number': '' }],
    ['Revision', { Revision: '   ' }],
    ['Name', { Name: null }],
  ])('rejects with 400 and creates nothing when %s is empty', async (prop, overrides) => {
    const { service, jiraClient } = setup(metadata(overrides));

    await expect(service.generateEpicFromURL(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(`missing ${prop}`),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('lists every missing property in one message', async () => {
    const { service } = setup(metadata({ Project: null, Revision: null }));

    await expect(service.generateEpicFromURL(URL)).rejects.toThrow('missing Project, Revision');
  });

  it.each([
    ['Project', { Project: 'Robot 2027' }],
    ['Project', { Project: 'VX27' }],
    ['Part number', { 'Part number': '12' }],
    ['Part number', { 'Part number': 'VF27A-0000' }],
    ['Revision', { Revision: 'AB' }],
    ['Revision', { Revision: 'a' }],
  ])('rejects a malformed %s', async (prop, overrides) => {
    const { service, jiraClient } = setup(metadata(overrides));

    await expect(service.generateEpicFromURL(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(`invalid ${prop}`),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('rejects a URL that points at a non-assembly tab', async () => {
    const { service, jiraClient } = setup({ ...metadata(), elementType: 0, mimeType: 'onshape/partstudio' });

    await expect(service.generateEpicFromURL(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('not an assembly'),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL with 400 without calling OnShape', async () => {
    const { service, onshapeClient } = setup(metadata());

    await expect(service.generateEpicFromURL('https://cad.onshape.com/nope')).rejects.toMatchObject({ status: 400 });
    expect(onshapeClient.getElementMetadata).not.toHaveBeenCalled();
  });
});
