import { jest } from '@jest/globals';
import { EpicService } from '../../src/server/services/epicService.js';

/**
 * Onboarding an assembly that has sub-assemblies: 1000 with 1100, 1200 and
 * 1300. A small stateful fake tracker stands in for Jira, so "already
 * exists" and "never created twice" are checked against what was written.
 */
describe('EpicService onboarding of sub-assemblies', () => {
  const DOC = '8c64dfdcb66184646a7a3f17';
  const WS = '82f00d3cbea6901ac26040bd';
  const id = (n) => String(n).padStart(24, '0').replace(/0/g, 'a').slice(0, 24);

  // Element ids and OnShape properties for each assembly.
  const EL = { 1000: id(1000), 1100: id(1100), 1200: id(1200), 1300: id(1300) };
  const PROPS = {
    1000: { Name: 'Robot', 'Part number': '1000', Revision: 'A', Project: 'VF27' },
    1100: { Name: 'Intake', 'Part number': '1100', Revision: 'A', Project: 'VF27' },
    1200: { Name: 'Shooter', 'Part number': '1200', Revision: 'A', Project: 'VF27' },
    1300: { Name: 'Climber', 'Part number': '1300', Revision: 'A', Project: 'VF27' },
  };
  const PROP_IDS = {
    Name: '57f3fb8efa3416c06701d60d',
    'Part number': '57f3fb8efa3416c06701d60f',
    Revision: '57f3fb8efa3416c06701d610',
    Project: '57f3fb8efa3416c06701d613',
  };
  const URL_1000 = `https://cad.onshape.com/documents/${DOC}/w/${WS}/e/${EL[1000]}`;

  const savedProject = process.env.PROJECT_KEY;
  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });
  afterAll(() => {
    if (savedProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = savedProject;
  });

  const sub = (n, extra = {}) => ({
    item: String(n / 100 - 9),
    name: PROPS[n].Name,
    partNumber: PROPS[n]['Part number'],
    revision: 'A',
    project: 'VF27',
    documentId: DOC,
    elementId: EL[n],
    wvmType: 'w',
    wvmId: WS,
    ...extra,
  });

  function metadataFor(n, over = {}) {
    const values = { ...PROPS[n], ...over };
    return {
      elementType: 1,
      mimeType: 'onshape/assembly',
      properties: Object.entries(PROP_IDS).map(([name, propertyId]) => ({ name, propertyId, value: values[name] })),
    };
  }

  /**
   * @param {object} opts
   * @param {string[]} [opts.alreadyOnboarded]  numbers (1000, 1100…) that exist in the tracker
   * @param {object[]} [opts.subs]              what the BOM reports
   */
  function setup({ alreadyOnboarded = [], subs, metaOverrides = {}, bomError = null, workspaces } = {}) {
    let next = 2000;
    const issues = [];
    const addIssue = (n) => {
      const key = `HAR-${next++}`;
      issues.push({
        key,
        fields: {
          summary: `VF27A-${PROPS[n]['Part number']}A ${PROPS[n].Name}`,
          issuetype: { name: 'Assembly' },
          status: { name: 'New' },
          created: '2026-10-29T20:15:40.000+0000',
          customfield_10300: DOC,
          customfield_10301: WS,
          customfield_10302: EL[n],
        },
      });
      return key;
    };
    alreadyOnboarded.forEach(addIssue);

    const created = [];
    const jiraClient = {
      searchIssues: jest.fn(async (jql) => {
        if (jql.includes('cf[10302]')) return issues;
        if (jql.includes('summary ~')) return issues;
        return [];
      }),
      createIssue: jest.fn(async (fields) => {
        const key = `HAR-${next++}`;
        created.push(fields.summary);
        issues.push({
          key,
          fields: {
            summary: fields.summary,
            issuetype: { name: 'Assembly' },
            status: { name: 'New' },
            created: new Date().toISOString(),
            customfield_10300: fields.customfield_10300,
            customfield_10301: fields.customfield_10301,
            customfield_10302: fields.customfield_10302,
          },
        });
        return { key };
      }),
      getIssue: jest.fn(async (key) => issues.find((i) => i.key === key)),
    };
    const numberOfElement = (el) => Number(Object.keys(EL).find((n) => EL[n] === el));
    const onshapeClient = {
      baseUrl: 'https://cad.onshape.com',
      getElementMetadata: jest.fn(async (doc, ws, el) => metadataFor(numberOfElement(el), metaOverrides[numberOfElement(el)])),
      getWorkspaces: jest.fn().mockResolvedValue(workspaces ?? [{ id: WS, name: 'Main' }]),
    };
    const bomService = {
      getBOMReport: jest.fn(async () => {
        if (bomError) throw bomError;
        return { parts: [], unidentified: [], subAssemblies: subs ?? [sub(1100), sub(1200), sub(1300)] };
      }),
    };
    const buildService = {
      createBuild: jest.fn(async ({ assemblyKey, name }) => ({
        key: `B-${assemblyKey}`, summary: `${name} Build 1`, assemblyKey, buildNumber: 1, status: 'Draft',
      })),
    };
    const service = new EpicService({ jiraClient, onshapeClient, buildService, bomService });
    return { service, jiraClient, onshapeClient, bomService, buildService, created, issues };
  }

  const statuses = (result) => result.subAssemblies.map((s) => [s.name, s.status]);

  describe('previewOnboarding', () => {
    it('lists each sub-assembly as new when none exist, and writes nothing', async () => {
      const { service, jiraClient } = setup();
      const result = await service.previewOnboarding(URL_1000);
      expect(result.status).toBe('new');
      expect(statuses(result)).toEqual([['Intake', 'new'], ['Shooter', 'new'], ['Climber', 'new']]);
      expect(result.subAssemblies[1].proposed.fullPartNumber).toBe('VF27A-1200A');
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('starts the BOM read early, afresh, for the configuration the link names', async () => {
      const { service, bomService } = setup();
      bomService.prefetch = jest.fn().mockResolvedValue({});
      await service.previewOnboarding(`${URL_1000}?configuration=Size%3DLarge`);
      expect(bomService.prefetch).toHaveBeenCalledTimes(1);
      expect(bomService.prefetch).toHaveBeenCalledWith(DOC, WS, EL[1000], 'Size=Large');
      // The list itself shares that read rather than forcing another.
      for (const call of bomService.getBOMReport.mock.calls) expect(call[5]).toBeUndefined();
    });

    it('reads the BOM for the configuration an existing Assembly follows', async () => {
      const { service, bomService, issues } = setup({ alreadyOnboarded: [1000] });
      issues[0].fields.description = 'Onshape configuration: Size=Small';
      bomService.prefetch = jest.fn().mockResolvedValue({});
      await service.previewOnboarding(URL_1000);
      expect(bomService.prefetch).toHaveBeenCalledWith(DOC, WS, EL[1000], 'Size=Small');
    });

    it('checks sub-assemblies at once but lists them in BOM order, reading a document\'s workspaces once', async () => {
      const byVersion = (n) => sub(n, { wvmType: 'v', wvmId: 'f'.repeat(24) });
      const { service, onshapeClient } = setup({ subs: [byVersion(1100), byVersion(1200), byVersion(1300)] });
      const result = await service.previewOnboarding(URL_1000);
      expect(statuses(result)).toEqual([['Intake', 'new'], ['Shooter', 'new'], ['Climber', 'new']]);
      expect(onshapeClient.getWorkspaces).toHaveBeenCalledTimes(1);
    });

    it('says a sub-assembly that was onboarded before already exists', async () => {
      const { service } = setup({ alreadyOnboarded: [1100] });
      const result = await service.previewOnboarding(URL_1000);
      expect(statuses(result)).toEqual([['Intake', 'exists'], ['Shooter', 'new'], ['Climber', 'new']]);
      expect(result.subAssemblies[0].assembly).toMatchObject({ key: 'HAR-2000', summary: 'VF27A-1100A Intake' });
      expect(result.subAssemblies[0]).not.toHaveProperty('ids');
    });

    it('reports a sub-assembly with incomplete OnShape properties without failing the rest', async () => {
      const { service } = setup({ metaOverrides: { 1200: { 'Part number': '' } } });
      const result = await service.previewOnboarding(URL_1000);
      expect(statuses(result)).toEqual([['Intake', 'new'], ['Shooter', 'problems'], ['Climber', 'new']]);
      expect(result.subAssemblies[1].problems[0]).toMatchObject({ property: 'Part number', issue: 'missing' });
    });

    it('reports a sub-assembly whose number belongs to a different OnShape assembly', async () => {
      const { service, issues } = setup();
      issues.push({
        key: 'HAR-1500',
        fields: {
          summary: 'VF27A-1200A Something else',
          issuetype: { name: 'Assembly' },
          status: { name: 'New' },
          customfield_10300: DOC,
          customfield_10301: WS,
          customfield_10302: id(7777),
        },
      });
      const result = await service.previewOnboarding(URL_1000);
      expect(result.subAssemblies[1]).toMatchObject({ status: 'conflict', assembly: { key: 'HAR-1500' } });
    });

    it('finds the Main workspace for a sub-assembly referenced by version', async () => {
      const { service, onshapeClient } = setup({
        subs: [sub(1100, { wvmType: 'v', wvmId: id(5555) })],
      });
      const result = await service.previewOnboarding(URL_1000);
      expect(onshapeClient.getWorkspaces).toHaveBeenCalledWith(DOC);
      expect(result.subAssemblies[0].proposed.workspaceId).toBe(WS);
    });

    it('still previews the main assembly when the BOM cannot be read, and says so', async () => {
      const err = Object.assign(new Error('boom'), { status: 502 });
      const { service } = setup({ bomError: err });
      const result = await service.previewOnboarding(URL_1000);
      expect(result.status).toBe('new');
      expect(result.subAssemblies).toEqual([]);
      expect(result.subAssembliesError).toEqual(expect.any(String));
    });

    it('lists sub-assemblies for an assembly that already exists, so missing ones can be added', async () => {
      const { service } = setup({ alreadyOnboarded: [1000, 1100] });
      const result = await service.previewOnboarding(URL_1000);
      expect(result.status).toBe('exists');
      expect(statuses(result)).toEqual([['Intake', 'exists'], ['Shooter', 'new'], ['Climber', 'new']]);
    });
  });

  describe('onboardAssembly', () => {
    it('creates 1000 and the sub-assemblies that are missing, and not the one that exists', async () => {
      const { service, created, buildService } = setup({ alreadyOnboarded: [1100] });
      const result = await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });

      expect(created).toEqual(['VF27A-1000A Robot', 'VF27A-1200A Shooter', 'VF27A-1300A Climber']);
      expect(result.status).toBe('created');
      expect(result.assembly.summary).toBe('VF27A-1000A Robot');
      expect(statuses(result)).toEqual([['Intake', 'exists'], ['Shooter', 'created'], ['Climber', 'created']]);
      expect(result.subAssemblies[0].assembly.key).toBe('HAR-2000');
      expect(result.subAssemblies[1].build).toMatchObject({ buildNumber: 1 });
      // Build 1 for 1000, 1200 and 1300 only.
      expect(buildService.createBuild).toHaveBeenCalledTimes(3);
    });

    it('creates all three when none exist', async () => {
      const { service, created } = setup();
      const result = await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });
      expect(created).toEqual([
        'VF27A-1000A Robot', 'VF27A-1100A Intake', 'VF27A-1200A Shooter', 'VF27A-1300A Climber',
      ]);
      expect(statuses(result)).toEqual([['Intake', 'created'], ['Shooter', 'created'], ['Climber', 'created']]);
    });

    it('creates nothing the second time: everything already exists', async () => {
      const { service, created } = setup();
      await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });
      const before = created.length;
      const again = await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });
      expect(created).toHaveLength(before);
      expect(again.status).toBe('exists');
      expect(statuses(again)).toEqual([['Intake', 'exists'], ['Shooter', 'exists'], ['Climber', 'exists']]);
    });

    it('adds only the missing sub-assemblies when the main assembly already exists', async () => {
      const { service, created } = setup({ alreadyOnboarded: [1000, 1100] });
      const result = await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });
      expect(created).toEqual(['VF27A-1200A Shooter', 'VF27A-1300A Climber']);
      expect(result.status).toBe('exists');
      expect(statuses(result)).toEqual([['Intake', 'exists'], ['Shooter', 'created'], ['Climber', 'created']]);
    });

    it('skips a sub-assembly with incomplete properties and still creates the others', async () => {
      const { service, created } = setup({ metaOverrides: { 1200: { Revision: '' } } });
      const result = await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });
      expect(created).toEqual(['VF27A-1000A Robot', 'VF27A-1100A Intake', 'VF27A-1300A Climber']);
      expect(statuses(result)).toEqual([['Intake', 'created'], ['Shooter', 'problems'], ['Climber', 'created']]);
    });

    it('reports a sub-assembly that fails to create and carries on', async () => {
      const { service, jiraClient } = setup();
      const real = jiraClient.createIssue.getMockImplementation();
      jiraClient.createIssue.mockImplementation(async (fields) => {
        if (fields.summary.includes('1200')) throw Object.assign(new Error('down'), { status: 503 });
        return real(fields);
      });
      const result = await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });
      expect(result.status).toBe('created');
      expect(statuses(result)).toEqual([['Intake', 'created'], ['Shooter', 'error'], ['Climber', 'created']]);
      expect(result.subAssemblies[1].message).toEqual(expect.any(String));
    });

    it('keeps the main assembly when the BOM cannot be read', async () => {
      const err = Object.assign(new Error('boom'), { status: 502 });
      const { service, created } = setup({ bomError: err });
      const result = await service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' });
      expect(created).toEqual(['VF27A-1000A Robot']);
      expect(result.status).toBe('created');
      expect(result.subAssemblies).toEqual([]);
      expect(result.subAssembliesError).toEqual(expect.any(String));
    });

    it('does not create the same sub-assembly twice for two concurrent requests', async () => {
      const { service, created } = setup({ alreadyOnboarded: [1000] });
      await Promise.all([
        service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' }),
        service.onboardAssembly({ url: URL_1000, expectedSummary: 'VF27A-1000A Robot' }),
      ]);
      expect(created.filter((s) => s.includes('1100'))).toHaveLength(1);
    });
  });
});

describe('EpicService sub-assembly with no Project of its own', () => {
  // Reproduces the real "Bumper": Part number and Revision set, Project empty.
  const DOC = '76ec7a909f54ee4dad4571e2';
  const WS = 'ede50c305e14429b395bff27';
  const BUMPER = '39ba6b7faead7e36b6a809a0';
  const props = (values) => ({
    elementType: 1,
    mimeType: 'onshape/assembly',
    properties: Object.entries({
      Name: '57f3fb8efa3416c06701d60d', 'Part number': '57f3fb8efa3416c06701d60f',
      Revision: '57f3fb8efa3416c06701d610', Project: '57f3fb8efa3416c06701d613',
    }).map(([name, propertyId]) => ({ name, propertyId, value: values[name] ?? null })),
  });
  const bom = (ownProject) => ({
    parts: [], unidentified: [],
    subAssemblies: [{ item: '2', name: 'Bumper', partNumber: '1200', revision: 'A', project: ownProject, documentId: DOC, elementId: BUMPER, wvmType: 'w', wvmId: WS }],
  });
  const make = (meta) => new EpicService({
    jiraClient: { searchIssues: jest.fn().mockResolvedValue([]) },
    onshapeClient: { getElementMetadata: jest.fn().mockResolvedValue(meta) },
    bomService: { getBOMReport: jest.fn().mockResolvedValue(bom('')) },
  });
  const ids = { documentId: DOC, workspaceId: WS, elementId: 'f'.repeat(24) };

  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });

  it('takes the parent Project, so the Bumper is new as VR27A-1200A', async () => {
    const service = make(props({ Name: 'Bumper', 'Part number': '1200', Revision: 'A', Project: null }));
    const result = await service._previewSubAssemblies(ids, { seasonType: 'R', year: '27' });
    expect(result.subAssemblies).toHaveLength(1);
    expect(result.subAssemblies[0]).toMatchObject({ status: 'new', proposed: { fullPartNumber: 'VR27A-1200A', project: 'VR27' } });
  });

  it('still reports the Project as missing when the parent season is unknown', async () => {
    const service = make(props({ Name: 'Bumper', 'Part number': '1200', Revision: 'A', Project: null }));
    const result = await service._previewSubAssemblies(ids, null);
    expect(result.subAssemblies[0].status).toBe('problems');
    expect(result.subAssemblies[0].problems.map((p) => p.property)).toEqual(['Project']);
  });

  it('keeps a Project the sub-assembly sets itself', async () => {
    const service = make(props({ Name: 'Bumper', 'Part number': '1200', Revision: 'A', Project: 'VF27' }));
    const result = await service._previewSubAssemblies(ids, { seasonType: 'R', year: '27' });
    expect(result.subAssemblies[0].proposed.fullPartNumber).toBe('VF27A-1200A');
  });

  it('still skips one with no Part number or Revision, like the real "[1130] Electrical"', async () => {
    const service = make(props({ Name: '[1130] Electrical' }));
    const result = await service._previewSubAssemblies(ids, { seasonType: 'R', year: '27' });
    expect(result.subAssemblies[0].status).toBe('problems');
    expect(result.subAssemblies[0].problems.map((p) => p.property)).toEqual(['Part number', 'Revision']);
  });
});

describe('EpicService names with [bracketed] tags', () => {
  const DOC = '76ec7a909f54ee4dad4571e2';
  const WS = 'ede50c305e14429b395bff27';
  const EL = 'dbfc048b0b9d3152f430d328';
  const meta = (name) => ({
    elementType: 1,
    mimeType: 'onshape/assembly',
    properties: [
      { name: 'Name', propertyId: '57f3fb8efa3416c06701d60d', value: name },
      { name: 'Part number', propertyId: '57f3fb8efa3416c06701d60f', value: '1300' },
      { name: 'Revision', propertyId: '57f3fb8efa3416c06701d610', value: 'A' },
      { name: 'Project', propertyId: '57f3fb8efa3416c06701d613', value: 'VR27' },
    ],
  });
  const make = (name) => new EpicService({
    jiraClient: { searchIssues: jest.fn().mockResolvedValue([]) },
    onshapeClient: { getElementMetadata: jest.fn().mockResolvedValue(meta(name)) },
  });
  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });

  it('drops the brackets from the Assembly name and summary', async () => {
    const proposed = await make('[1300] Electrical')._readOnshapeAssembly({ documentId: DOC, workspaceId: WS, elementId: EL });
    expect(proposed).toMatchObject({ name: 'Electrical', summary: 'VR27A-1300A Electrical', fullPartNumber: 'VR27A-1300A' });
  });

  it('uses the cleaned name for a sub-assembly too', async () => {
    const service = make('[1300] Electrical');
    const result = await service._checkSubAssembly(
      { name: '[1300] Electrical', documentId: DOC, elementId: EL, wvmType: 'w', wvmId: WS }, new Map(),
    );
    expect(result).toMatchObject({ status: 'new', name: 'Electrical', proposed: { summary: 'VR27A-1300A Electrical' } });
  });
});
