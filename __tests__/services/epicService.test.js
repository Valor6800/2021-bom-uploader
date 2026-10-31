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

describe('EpicService.resolveOnshapeAssembly', () => {
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

  it('builds the summary from Project, Part number, Revision and Name without writing', async () => {
    const { service, jiraClient, onshapeClient } = setup(metadata());

    const result = await service.resolveOnshapeAssembly(URL);

    expect(onshapeClient.getElementMetadata).toHaveBeenCalledWith(
      '8c64dfdcb66184646a7a3f17', '82f00d3cbea6901ac26040bd', 'faea62821490977c33bc8d7c',
    );
    expect(result).toEqual(expect.objectContaining({
      summary: 'VF27A-0000A Test Assembly',
      fullPartNumber: 'VF27A-0000A',
      revision: 'A',
      documentId: '8c64dfdcb66184646a7a3f17',
      workspaceId: '82f00d3cbea6901ac26040bd',
      elementId: 'faea62821490977c33bc8d7c',
    }));
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('falls back to the property name when the property id differs', async () => {
    const meta = metadata();
    meta.properties = meta.properties.map((p) => ({ ...p, propertyId: `other-${p.propertyId}` }));
    const { service } = setup(meta);

    const result = await service.resolveOnshapeAssembly(URL);

    expect(result.summary).toBe('VF27A-0000A Test Assembly');
  });

  it('trims whitespace around property values', async () => {
    const { service } = setup(metadata({ Project: ' VF27 ', Name: ' Test Assembly ' }));

    const result = await service.resolveOnshapeAssembly(URL);

    expect(result.summary).toBe('VF27A-0000A Test Assembly');
  });

  it.each([
    ['Project', { Project: null }],
    ['Part number', { 'Part number': '' }],
    ['Revision', { Revision: '   ' }],
    ['Name', { Name: null }],
  ])('rejects with 400 and creates nothing when %s is empty', async (prop, overrides) => {
    const { service, jiraClient } = setup(metadata(overrides));

    await expect(service.resolveOnshapeAssembly(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(`missing ${prop}`),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('lists every missing property in one message', async () => {
    const { service } = setup(metadata({ Project: null, Revision: null }));

    await expect(service.resolveOnshapeAssembly(URL)).rejects.toThrow('missing Project, Revision');
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

    await expect(service.resolveOnshapeAssembly(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(`invalid ${prop}`),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('rejects a URL that points at a non-assembly tab', async () => {
    const { service, jiraClient } = setup({ ...metadata(), elementType: 0, mimeType: 'onshape/partstudio' });

    await expect(service.resolveOnshapeAssembly(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('not an assembly'),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL with 400 without calling OnShape', async () => {
    const { service, onshapeClient } = setup(metadata());

    await expect(service.resolveOnshapeAssembly('https://cad.onshape.com/nope')).rejects.toMatchObject({ status: 400 });
    expect(onshapeClient.getElementMetadata).not.toHaveBeenCalled();
  });
});

describe('EpicService.getEpic', () => {
  it('uses phrase JQL on summary and ignores a hit whose parsed number differs', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        { key: 'HAR-1', fields: { summary: 'VF27A-0000B Test Assembly' } },
        { key: 'HAR-2', fields: { summary: 'VF27A-0000A Test Assembly' } },
      ]),
    });
    const service = new EpicService({ jiraClient });
    const result = await service.getEpic('VF27A-0000A');
    const [jql] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toContain('summary ~ "\\"VF27A-0000A\\""');
    expect(jql).not.toContain('text ~');
    expect(result.key).toBe('HAR-2');
  });

  it('returns null when no hit has exactly that number', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([{ key: 'HAR-1', fields: { summary: 'VF27A-0000B X' } }]),
    });
    await expect(new EpicService({ jiraClient }).getEpic('VF27A-0000A')).resolves.toBeNull();
  });
});

describe('EpicService onboarding (B5)', () => {
  const DOC = '8c64dfdcb66184646a7a3f17';
  const WS = '82f00d3cbea6901ac26040bd';
  const EL = 'faea62821490977c33bc8d7c';
  const OTHER = '0123456789abcdef01234567';
  const URL = `https://cad.onshape.com/documents/${DOC}/w/${WS}/e/${EL}`;
  const SUMMARY = 'VF27A-0000A Test Assembly';

  const savedProject = process.env.PROJECT_KEY;
  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });
  afterAll(() => {
    if (savedProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = savedProject;
  });

  function metadata(overrides = {}) {
    const values = { Name: 'Test Assembly', 'Part number': '0000', Revision: 'A', Project: 'VF27', ...overrides };
    const ids = {
      Name: '57f3fb8efa3416c06701d60d',
      'Part number': '57f3fb8efa3416c06701d60f',
      Revision: '57f3fb8efa3416c06701d610',
      Project: '57f3fb8efa3416c06701d613',
    };
    return {
      elementType: 1,
      mimeType: 'onshape/assembly',
      properties: Object.entries(ids).map(([name, propertyId]) => ({ name, propertyId, value: values[name] })),
    };
  }

  function assemblyIssue(key, { doc = DOC, ws = WS, el = EL, summary = SUMMARY, created = '2026-10-29T20:15:40.000+0000' } = {}) {
    return {
      key,
      fields: {
        summary,
        issuetype: { name: 'Assembly' },
        status: { name: 'New' },
        created,
        customfield_10300: doc,
        customfield_10301: ws,
        customfield_10302: el,
      },
    };
  }

  /**
   * Route searchIssues by query: element lookups, number lookups, and the
   * Build-number query BuildService runs.
   */
  function setup({ byElement = [], byNumber = [], meta = metadata(), createIssue, buildService, getIssue } = {}) {
    const searchIssues = jest.fn(async (jql) => {
      if (jql.includes('cf[10302]')) return byElement;
      if (jql.includes('summary ~')) return byNumber;
      return [];
    });
    const jiraClient = makeJiraClient({
      searchIssues,
      createIssue: createIssue ?? jest.fn().mockResolvedValue({ key: 'HAR-2050' }),
      getIssue: getIssue ?? jest.fn(),
    });
    const onshapeClient = {
      baseUrl: 'https://cad.onshape.com',
      getElementMetadata: jest.fn().mockResolvedValue(meta),
    };
    const builds = buildService ?? {
      createBuild: jest.fn().mockResolvedValue({
        key: 'HAR-2051', summary: 'Test Assembly Build 1', assemblyKey: 'HAR-2050',
        buildNumber: 1, status: 'Draft', onshapeVersionLink: null,
      }),
    };
    const service = new EpicService({ jiraClient, onshapeClient, buildService: builds });
    return { service, jiraClient, onshapeClient, buildService: builds };
  }

  describe('previewOnboarding', () => {
    it('answers exists for an exact element and document match on this workspace, without reading OnShape', async () => {
      const { service, onshapeClient, jiraClient } = setup({ byElement: [assemblyIssue('HAR-2030')] });
      const result = await service.previewOnboarding(URL);
      expect(result).toEqual(expect.objectContaining({ status: 'exists', matchedOn: 'workspace' }));
      expect(result.assembly.key).toBe('HAR-2030');
      expect(onshapeClient.getElementMetadata).not.toHaveBeenCalled();
      const [jql] = jiraClient.searchIssues.mock.calls[0];
      expect(jql).toBe(`project = HAR AND issuetype = Assembly AND cf[10302] ~ "${EL}"`);
    });

    it('answers matchedOn document for a match on another workspace', async () => {
      const { service } = setup({ byElement: [assemblyIssue('HAR-2030', { ws: OTHER })] });
      const result = await service.previewOnboarding(URL);
      expect(result).toEqual(expect.objectContaining({ status: 'exists', matchedOn: 'document' }));
    });

    it('prefers the same-workspace match over a newer one elsewhere', async () => {
      const { service } = setup({
        byElement: [
          assemblyIssue('HAR-2040', { ws: OTHER, created: '2026-10-30T00:00:00.000+0000' }),
          assemblyIssue('HAR-2030'),
        ],
      });
      const result = await service.previewOnboarding(URL);
      expect(result.assembly.key).toBe('HAR-2030');
      expect(result.matchedOn).toBe('workspace');
    });

    it('does not count the same element id in a different document as a duplicate', async () => {
      const { service } = setup({ byElement: [assemblyIssue('HAR-2030', { doc: OTHER })] });
      const result = await service.previewOnboarding(URL);
      expect(result.status).toBe('new');
    });

    it('ignores a ~ hit whose element id is not an exact match', async () => {
      const { service } = setup({ byElement: [assemblyIssue('HAR-2030', { el: `${EL.slice(0, 23)}0` })] });
      const result = await service.previewOnboarding(URL);
      expect(result.status).toBe('new');
    });

    it('proposes the Assembly built from the OnShape properties', async () => {
      const { service, jiraClient } = setup();
      const result = await service.previewOnboarding(URL);
      expect(result).toEqual({
        status: 'new',
        subAssemblies: [],
        proposed: expect.objectContaining({
          summary: SUMMARY,
          fullPartNumber: 'VF27A-0000A',
          name: 'Test Assembly',
          revision: 'A',
          seasonLabel: 'Facility 2027',
          documentId: DOC,
          workspaceId: WS,
          elementId: EL,
        }),
      });
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('answers 409 with the other Assembly when the number belongs to another element', async () => {
      const { service } = setup({ byNumber: [assemblyIssue('HAR-2040', { el: OTHER, summary: 'VF27A-0000A Old Test' })] });
      await expect(service.previewOnboarding(URL)).rejects.toMatchObject({
        status: 409,
        message: 'VF27A-0000A is already used by HAR-2040.',
        details: { assembly: expect.objectContaining({ key: 'HAR-2040' }), proposed: expect.objectContaining({ summary: SUMMARY }) },
      });
    });

    it('lists incomplete properties in problems[]', async () => {
      const { service } = setup({ meta: metadata({ Project: null, 'Part number': '12' }) });
      await expect(service.previewOnboarding(URL)).rejects.toMatchObject({
        status: 400,
        details: {
          problems: [
            { property: 'Project', issue: 'missing', hint: expect.any(String) },
            { property: 'Part number', issue: 'invalid', value: '12', hint: expect.any(String) },
          ],
        },
      });
    });

    it('refuses a version link with a hint to use the workspace link', async () => {
      const { service, jiraClient } = setup();
      await expect(service.previewOnboarding(`https://cad.onshape.com/documents/${DOC}/v/${WS}/e/${EL}`))
        .rejects.toMatchObject({ status: 400, message: 'Use the link to the workspace (it has /w/ in it), not a version.' });
      expect(jiraClient.searchIssues).not.toHaveBeenCalled();
    });

    it('refuses ids that are not 24 hex characters before any JQL', async () => {
      const { service, jiraClient } = setup();
      await expect(service.previewOnboarding('https://cad.onshape.com/documents/aaa/w/bbb/e/ccc'))
        .rejects.toMatchObject({ status: 400 });
      expect(jiraClient.searchIssues).not.toHaveBeenCalled();
    });

    it('turns an OnShape 404 into a student-facing 400', async () => {
      const { service, onshapeClient } = setup();
      onshapeClient.getElementMetadata.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
      await expect(service.previewOnboarding(URL)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("OnShape couldn't open that link"),
      });
    });

    it('passes other OnShape errors through', async () => {
      const { OnshapeApiError } = await import('../../src/server/clients/onshapeClient.js');
      const { service, onshapeClient } = setup();
      onshapeClient.getElementMetadata.mockRejectedValue(new OnshapeApiError('bad gateway', 502, '/metadata'));
      await expect(service.previewOnboarding(URL)).rejects.toMatchObject({ status: 502, name: 'OnshapeApiError' });
    });
  });

  describe('onboardAssembly', () => {
    it('creates the Assembly and Build 1 and builds the Assembly without a read', async () => {
      const getIssue = jest.fn().mockRejectedValue(new Error('should not be read'));
      const { service, jiraClient, buildService } = setup({ getIssue });
      const result = await service.onboardAssembly({ url: URL, expectedSummary: SUMMARY });
      expect(result.status).toBe('created');
      expect(result.buildError).toBeNull();
      expect(result.build.key).toBe('HAR-2051');
      expect(result.assembly).toEqual(expect.objectContaining({
        key: 'HAR-2050',
        fullPartNumber: 'VF27A-0000A',
        revision: 'A',
        onshapeUrl: `https://cad.onshape.com/documents/${DOC}/w/${WS}/e/${EL}`,
      }));
      expect(getIssue).not.toHaveBeenCalled();
      expect(jiraClient.createIssue).toHaveBeenCalledTimes(1);
      expect(buildService.createBuild).toHaveBeenCalledWith({
        assemblyKey: 'HAR-2050', revisionChainKeys: ['HAR-2050'], name: 'Test Assembly',
      });
    });

    it('gives Build 1 a summary with no " - " suffix', async () => {
      const { BuildService } = await import('../../src/server/services/buildService.js');
      const buildJira = {
        searchIssues: jest.fn().mockResolvedValue([]),
        createIssue: jest.fn().mockResolvedValue({ key: 'HAR-2051' }),
      };
      const { service } = setup({ buildService: new BuildService({ jiraClient: buildJira }) });
      const result = await service.onboardAssembly({ url: URL, expectedSummary: SUMMARY });
      expect(buildJira.createIssue.mock.calls[0][0].summary).toBe('Test Assembly Build 1');
      expect(result.build.summary).toBe('Test Assembly Build 1');
      expect(result.build.summary).not.toContain(' - ');
    });

    it('answers exists and creates nothing when the element is already onboarded', async () => {
      const { service, jiraClient, buildService } = setup({ byElement: [assemblyIssue('HAR-2030')] });
      const result = await service.onboardAssembly({ url: URL, expectedSummary: SUMMARY });
      expect(result).toEqual(expect.objectContaining({ status: 'exists', build: null }));
      expect(result.assembly.key).toBe('HAR-2030');
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
      expect(buildService.createBuild).not.toHaveBeenCalled();
    });

    it('answers 409 with proposed when the OnShape summary drifted', async () => {
      const { service, jiraClient } = setup();
      await expect(service.onboardAssembly({ url: URL, expectedSummary: 'VF27A-0000A Old Name' }))
        .rejects.toMatchObject({
          status: 409,
          message: 'The OnShape properties changed since you checked. Review the new name.',
          details: { proposed: expect.objectContaining({ summary: SUMMARY }) },
        });
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('answers 409 with assembly when the number is used by another element', async () => {
      const { service, jiraClient } = setup({ byNumber: [assemblyIssue('HAR-2040', { el: OTHER })] });
      await expect(service.onboardAssembly({ url: URL, expectedSummary: SUMMARY }))
        .rejects.toMatchObject({ status: 409, details: { assembly: expect.objectContaining({ key: 'HAR-2040' }) } });
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('returns created with buildError when Build 1 fails', async () => {
      const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
      const buildService = { createBuild: jest.fn().mockRejectedValue(new JiraApiError('down', 503, '/issue')) };
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { service } = setup({ buildService });
      const result = await service.onboardAssembly({ url: URL, expectedSummary: SUMMARY });
      warn.mockRestore();
      expect(result).toEqual(expect.objectContaining({
        status: 'created',
        build: null,
        buildError: "the team tracker didn't respond (503)",
      }));
      expect(result.assembly.key).toBe('HAR-2050');
    });

    it('creates no Build when the Assembly create fails', async () => {
      const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
      const { service, buildService } = setup({
        createIssue: jest.fn().mockRejectedValue(new JiraApiError('down', 503, '/issue')),
      });
      await expect(service.onboardAssembly({ url: URL, expectedSummary: SUMMARY })).rejects.toMatchObject({ status: 503 });
      expect(buildService.createBuild).not.toHaveBeenCalled();
    });

    it('runs one create for two concurrent calls; the second answers exists with the Build', async () => {
      const { service, jiraClient, buildService } = setup();
      const [a, b] = await Promise.all([
        service.onboardAssembly({ url: URL, expectedSummary: SUMMARY }),
        service.onboardAssembly({ url: URL, expectedSummary: SUMMARY }),
      ]);
      expect(jiraClient.createIssue).toHaveBeenCalledTimes(1);
      expect(buildService.createBuild).toHaveBeenCalledTimes(1);
      expect(a.status).toBe('created');
      expect(b).toEqual({ status: 'exists', assembly: a.assembly, build: a.build });
    });

    it('gives a concurrent waiter with a different summary a 409 drift', async () => {
      const { service } = setup();
      const results = await Promise.allSettled([
        service.onboardAssembly({ url: URL, expectedSummary: SUMMARY }),
        service.onboardAssembly({ url: URL, expectedSummary: 'VF27A-0000A Other' }),
      ]);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[1].reason).toMatchObject({ status: 409, details: { proposed: expect.objectContaining({ summary: SUMMARY }) } });
    });

    it('lets a waiter re-run when the first call failed', async () => {
      const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
      const createIssue = jest.fn()
        .mockRejectedValueOnce(new JiraApiError('down', 503, '/issue'))
        .mockResolvedValueOnce({ key: 'HAR-2052' });
      const { service } = setup({ createIssue });
      const results = await Promise.allSettled([
        service.onboardAssembly({ url: URL, expectedSummary: SUMMARY }),
        service.onboardAssembly({ url: URL, expectedSummary: SUMMARY }),
      ]);
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
      expect(results[1].value.assembly.key).toBe('HAR-2052');
      expect(createIssue).toHaveBeenCalledTimes(2);
    });

    it('remembers a just-created Assembly so a preview during search lag answers exists', async () => {
      const getIssue = jest.fn().mockResolvedValue(assemblyIssue('HAR-2050'));
      const { service, onshapeClient } = setup({ getIssue });
      await service.onboardAssembly({ url: URL, expectedSummary: SUMMARY });
      onshapeClient.getElementMetadata.mockClear();

      const result = await service.previewOnboarding(URL);
      expect(result).toEqual(expect.objectContaining({ status: 'exists', matchedOn: 'workspace' }));
      expect(result.assembly.key).toBe('HAR-2050');
      expect(getIssue).toHaveBeenCalledWith('HAR-2050', expect.any(Object));
      expect(onshapeClient.getElementMetadata).not.toHaveBeenCalled();
    });

    it('does not use the recently-created record for a different document', async () => {
      const getIssue = jest.fn();
      const { service } = setup({ getIssue });
      await service.onboardAssembly({ url: URL, expectedSummary: SUMMARY });
      const result = await service.previewOnboarding(`https://cad.onshape.com/documents/${OTHER}/w/${WS}/e/${EL}`);
      expect(result.status).toBe('new');
      expect(getIssue).not.toHaveBeenCalled();
    });

    it('requires a buildService', async () => {
      const service = new EpicService({ jiraClient: makeJiraClient(), onshapeClient: {} });
      await expect(service.onboardAssembly({ url: URL, expectedSummary: SUMMARY }))
        .rejects.toThrow('onboardAssembly requires a buildService dependency');
    });
  });
});
