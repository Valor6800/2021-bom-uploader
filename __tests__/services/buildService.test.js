import { jest } from '@jest/globals';
import { BuildService } from '../../src/server/services/buildService.js';
import { BuildField, BuildStatus, BuildTransition, LinkType, RevisionField } from '../../src/server/utils/buildConstants.js';

function makeJiraClient(overrides = {}) {
  return {
    searchIssues: jest.fn().mockResolvedValue([]),
    createIssue: jest.fn().mockResolvedValue({ key: 'VAL-900' }),
    updateIssue: jest.fn().mockResolvedValue(undefined),
    transitionIssue: jest.fn().mockResolvedValue(undefined),
    createIssueLink: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeOnshapeClient(overrides = {}) {
  return {
    baseUrl: 'https://cad.onshape.com',
    createVersion: jest.fn().mockResolvedValue({ id: 'v123', name: 'VAL-11' }),
    ...overrides,
  };
}

function makeRevisionService(overrides = {}) {
  return {
    createRevision: jest.fn().mockResolvedValue({ key: 'VAL-51', revision: 'B' }),
    ...overrides,
  };
}

function buildIssue(key, { buildNumber, status, assemblyKey = 'VAL-1' } = {}) {
  return {
    key,
    fields: {
      summary: `Intake Build ${buildNumber}`,
      [BuildField.ASSEMBLY_LINK]: assemblyKey,
      [BuildField.BUILD_NUMBER]: buildNumber,
      status: { name: status },
    },
  };
}

describe('BuildService.getBuildsForAssemblies', () => {
  it('returns an empty array without querying when no keys are given', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    const result = await service.getBuildsForAssemblies([]);
    expect(result).toEqual([]);
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
  });

  it('builds JQL scoped to Build issues linked to the given Assembly keys', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    await service.getBuildsForAssemblies(['VAL-1', 'VAL-2']);

    const [jql] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toContain('issuetype = Build');
    expect(jql).toContain('"Epic Link" in (VAL-1, VAL-2)');
  });

  it('parses Build fields into plain objects', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-10', { buildNumber: 2, status: BuildStatus.ACTIVE }),
      ]),
    });
    const service = new BuildService({ jiraClient });

    const [build] = await service.getBuildsForAssemblies(['VAL-1']);
    expect(build).toMatchObject({
      key: 'VAL-10',
      buildNumber: 2,
      status: BuildStatus.ACTIVE,
      assemblyKey: 'VAL-1',
    });
  });
});

describe('BuildService.getNextBuildNumber', () => {
  it('returns 1 when the assembly has no builds yet', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    await expect(service.getNextBuildNumber(['VAL-1'])).resolves.toBe(1);
  });

  it('returns one past the highest existing build number, across the whole revision chain', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.SUPERSEDED, assemblyKey: 'VAL-1' }),
        buildIssue('VAL-11', { buildNumber: 2, status: BuildStatus.ACTIVE, assemblyKey: 'VAL-1B' }),
      ]),
    });
    const service = new BuildService({ jiraClient });

    await expect(service.getNextBuildNumber(['VAL-1', 'VAL-1B'])).resolves.toBe(3);
  });
});

describe('BuildService.createBuild', () => {
  it('assigns the next build number and creates the issue with the right fields', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.ACTIVE }),
      ]),
      createIssue: jest.fn().mockResolvedValue({ key: 'VAL-11' }),
    });
    const service = new BuildService({ jiraClient });

    const result = await service.createBuild({ assemblyKey: 'VAL-1', name: 'Intake' });

    expect(result).toEqual({
      key: 'VAL-11',
      summary: 'Intake Build 2',
      assemblyKey: 'VAL-1',
      buildNumber: 2,
      status: BuildStatus.DRAFT,
      onshapeVersionLink: null,
    });
    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields.issuetype).toEqual({ name: 'Build' });
    expect(fields.summary).toBe('Intake Build 2');
    expect(fields[BuildField.ASSEMBLY_LINK]).toBe('VAL-1');
    expect(fields[BuildField.BUILD_NUMBER]).toBe(2);
  });

  it('numbers against the full revision chain when one is given', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.SUPERSEDED, assemblyKey: 'VAL-1' }),
        buildIssue('VAL-11', { buildNumber: 2, status: BuildStatus.ARCHIVED, assemblyKey: 'VAL-1' }),
      ]),
    });
    const service = new BuildService({ jiraClient });

    const result = await service.createBuild({
      assemblyKey: 'VAL-1B',
      revisionChainKeys: ['VAL-1', 'VAL-1B'],
      name: 'Intake',
    });

    expect(result.buildNumber).toBe(3);
  });
});

describe('BuildService.linkPartToBuild', () => {
  it('creates a Used In link with the Part on the inward side', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    await service.linkPartToBuild('VAL-50', 'VAL-11');

    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'VAL-50', 'VAL-11');
  });
});

describe('BuildService.cutVersion', () => {
  it('writes the version link and transitions the build to Active', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    await service.cutVersion({
      buildKey: 'VAL-11',
      assemblyKey: 'VAL-1',
      onshapeVersionLink: 'https://cad.onshape.com/documents/d/w/v/VERSION123',
    });

    expect(jiraClient.updateIssue).toHaveBeenCalledWith('VAL-11', {
      [BuildField.ONSHAPE_VERSION_LINK]: 'https://cad.onshape.com/documents/d/w/v/VERSION123',
    });
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('VAL-11', BuildTransition.CUT_VERSION);
  });

  it('supersedes the previously-Active sibling under the same Assembly, excluding itself', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.ACTIVE, assemblyKey: 'VAL-1' }),
        buildIssue('VAL-11', { buildNumber: 2, status: BuildStatus.DRAFT, assemblyKey: 'VAL-1' }),
      ]),
      getIssue: jest.fn().mockResolvedValue({ fields: { status: { name: BuildStatus.ACTIVE } } }),
    });
    const service = new BuildService({ jiraClient });

    const result = await service.cutVersion({
      buildKey: 'VAL-11',
      assemblyKey: 'VAL-1',
      onshapeVersionLink: 'https://cad.onshape.com/x',
    });

    expect(result.superseded).toEqual(['VAL-10']);
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('VAL-10', BuildTransition.SUPERSEDE);
    // Only the sibling, never the build that was just cut.
    expect(jiraClient.transitionIssue).not.toHaveBeenCalledWith('VAL-11', BuildTransition.SUPERSEDE);
  });

  it('supersedes nothing when no sibling is currently Active', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-11', { buildNumber: 1, status: BuildStatus.DRAFT, assemblyKey: 'VAL-1' }),
      ]),
    });
    const service = new BuildService({ jiraClient });

    const result = await service.cutVersion({
      buildKey: 'VAL-11',
      assemblyKey: 'VAL-1',
      onshapeVersionLink: 'https://cad.onshape.com/x',
    });

    expect(result.superseded).toEqual([]);
  });
});

describe('BuildService.cutVersionFromOnshape', () => {
  it('throws when no onshapeClient was given', async () => {
    const service = new BuildService({ jiraClient: makeJiraClient() });

    await expect(service.cutVersionFromOnshape({
      buildKey: 'VAL-11', assemblyKey: 'VAL-1',
    })).rejects.toThrow('requires an onshapeClient');
  });
});

describe('BuildService.getLinkedParts', () => {
  it('returns the keys of parts linked to the build', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([{ key: 'VAL-50' }, { key: 'VAL-51' }]),
    });
    const service = new BuildService({ jiraClient });

    await expect(service.getLinkedParts('VAL-11')).resolves.toEqual(['VAL-50', 'VAL-51']);
    const [jql] = jiraClient.searchIssues.mock.calls[0];
    // Jira's linkedIssues() takes link descriptions, not the type name "Used In".
    expect(jql).toContain('linkedIssues(VAL-11, "is used in")');
    expect(jql).toContain('linkedIssues(VAL-11, "uses")');
    expect(jql).not.toContain(`"${LinkType.USED_IN}"`);
  });
});

describe('BuildService.cloneBuildParts', () => {
  it('links every part from the source build onto the target build', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([{ key: 'VAL-50' }, { key: 'VAL-51' }]),
    });
    const service = new BuildService({ jiraClient });

    const result = await service.cloneBuildParts('VAL-10', 'VAL-11');

    expect(result).toEqual({ linked: ['VAL-50', 'VAL-51'], failed: [] });
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'VAL-50', 'VAL-11');
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'VAL-51', 'VAL-11');
  });

  it('links nothing when the source build has no parts', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    const result = await service.cloneBuildParts('VAL-10', 'VAL-11');

    expect(result).toEqual({ linked: [], failed: [] });
    expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
  });
});

describe('BuildService.archiveBuild', () => {
  it('transitions the build via the Archive transition', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    await service.archiveBuild('VAL-11');

    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('VAL-11', BuildTransition.ARCHIVE);
  });
});

describe('BuildService.getBuildsForPart', () => {
  it('queries linkedIssues on the Used In link type and parses the results', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-11', { buildNumber: 2, status: 'Active' }),
        buildIssue('VAL-10', { buildNumber: 1, status: 'Superseded' }),
      ]),
    });
    const service = new BuildService({ jiraClient });

    const result = await service.getBuildsForPart('VAL-50');

    expect(result).toEqual([
      expect.objectContaining({ key: 'VAL-11', buildNumber: 2, status: 'Active' }),
      expect.objectContaining({ key: 'VAL-10', buildNumber: 1, status: 'Superseded' }),
    ]);
    const [jql] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toContain('linkedIssues(VAL-50, "is used in")');
    expect(jql).toContain('linkedIssues(VAL-50, "uses")');
    expect(jql).not.toContain(`"${LinkType.USED_IN}"`);
    expect(jql).toMatch(/ORDER BY "Build Number" DESC$/);
  });
});

describe('BuildService.recreateForBuild', () => {
  function makePreviousPartIssue(overrides = {}) {
    return {
      key: 'VAL-50',
      fields: {
        summary: 'VR26P-0001A Side Plate',
        [RevisionField.REVISION]: null,
        customfield_10110: 'VAL-1',
        customfield_10201: [{ value: 'CNC Mill' }],
        customfield_10202: { value: 'AL 6061' },
        customfield_10206: 2,
        issuelinks: [],
        ...overrides,
      },
    };
  }

  function setup(previous = makePreviousPartIssue()) {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockImplementation((key) => Promise.resolve(key === 'VAL-11'
        ? { key, fields: { issuetype: { name: 'Build' }, customfield_10110: 'VAL-1' } }
        : previous)),
    });
    const revisionService = makeRevisionService({ getRevisionChain: jest.fn().mockResolvedValue(['VAL-1']) });
    const partService = { getStoriesByEpics: jest.fn().mockResolvedValue([]) };
    return { jiraClient, revisionService, service: new BuildService({ jiraClient, revisionService, partService }) };
  }

  it('throws without a revisionService dependency', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    await expect(service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' }))
      .rejects.toThrow('revisionService');
  });

  it('creates the next revision with carried-forward fields and links it to the target build', async () => {
    const { jiraClient, revisionService, service } = setup();

    const result = await service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' });

    expect(result).toMatchObject({ key: 'VAL-51', revision: 'B' });
    expect(revisionService.createRevision).toHaveBeenCalledWith({
      previousKey: 'VAL-50',
      issueTypeName: 'Part',
      summary: 'VR26P-0001B Side Plate',
      extraFields: {
        customfield_10110: 'VAL-1',
        customfield_10201: [{ value: 'CNC Mill' }],
        customfield_10202: { value: 'AL 6061' },
        customfield_10206: 2,
      },
    });
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'VAL-51', 'VAL-11');
  });

  it('carries forward powdercoat and thickness only when set', async () => {
    const { revisionService, service } = setup(makePreviousPartIssue({
      customfield_10204: { value: 'Black' },
      customfield_10207: { value: '0.125' },
    }));

    await service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' });

    const [{ extraFields }] = revisionService.createRevision.mock.calls[0];
    expect(extraFields.customfield_10204).toEqual({ value: 'Black' });
    expect(extraFields.customfield_10207).toEqual({ value: '0.125' });
  });

  it('rejects a Part whose summary does not match the part number format with 400', async () => {
    const { service } = setup(makePreviousPartIssue({ summary: 'not a part number' }));

    await expect(service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('Part number format') });
  });
});

describe('BuildService.createBuild (INC-3)', () => {
  function chainService({ chain = ['VAL-1'], builds = [], getIssue, createKey = 'VAL-12' } = {}) {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue(builds),
      createIssue: jest.fn().mockResolvedValue({ key: createKey }),
      getIssue: getIssue ?? jest.fn(),
    });
    const revisionService = makeRevisionService({
      getRevisionChain: jest.fn().mockResolvedValue(chain),
    });
    return { jiraClient, revisionService, service: new BuildService({ jiraClient, revisionService }) };
  }

  it('derives the chain on the server and unions it with the caller keys', async () => {
    const { service, jiraClient, revisionService } = chainService({ chain: ['VAL-1B', 'VAL-1'] });
    await service.createBuild({ assemblyKey: 'VAL-1B', revisionChainKeys: ['VAL-1B', 'VAL-7'], name: 'Intake' });
    expect(revisionService.getRevisionChain).toHaveBeenCalledWith('VAL-1B');
    const [jql] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toContain('"Epic Link" in (VAL-1B, VAL-1, VAL-7)');
  });

  it('numbers past a Build the stale client chain did not know about', async () => {
    const { service } = chainService({
      chain: ['VAL-1B', 'VAL-1'],
      builds: [buildIssue('VAL-10', { buildNumber: 4, status: BuildStatus.ACTIVE, assemblyKey: 'VAL-1' })],
    });
    const result = await service.createBuild({ assemblyKey: 'VAL-1B', revisionChainKeys: ['VAL-1B'], name: 'Intake' });
    expect(result.buildNumber).toBe(5);
  });

  it('returns the Build object a client can select before search indexes it', async () => {
    const { service } = chainService({
      builds: [buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.ACTIVE })],
    });
    const result = await service.createBuild({ assemblyKey: 'VAL-1', name: 'Test Assembly' });
    expect(result).toEqual({
      key: 'VAL-12',
      summary: 'Test Assembly Build 2',
      assemblyKey: 'VAL-1',
      buildNumber: 2,
      status: 'Draft',
      onshapeVersionLink: null,
    });
  });

  it('appends the description to the summary and still writes the number to customfield_10501', async () => {
    const { service, jiraClient } = chainService({
      builds: [buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.ACTIVE })],
    });
    const result = await service.createBuild({ assemblyKey: 'VAL-1', name: 'Test Assembly', description: '1in bash bar' });
    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields.summary).toBe('Test Assembly Build 2 - 1in bash bar');
    expect(result.summary).toBe('Test Assembly Build 2 - 1in bash bar');
    expect(fields.customfield_10501).toBe(2);
    expect(result.buildNumber).toBe(2);
  });

  it('writes customfield_10501 equal to the returned number with no description (B6)', async () => {
    const { service, jiraClient } = chainService({
      builds: [buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.ACTIVE })],
    });
    const result = await service.createBuild({ assemblyKey: 'VAL-1', name: 'Test Assembly', description: '   ' });
    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields.summary).toBe('Test Assembly Build 2');
    expect(fields.customfield_10501).toBe(2);
    expect(fields.customfield_10501).toBe(result.buildNumber);
  });

  it('accepts a clone source that is a Build of this chain', async () => {
    const getIssue = jest.fn().mockResolvedValue({
      key: 'VAL-10', fields: { issuetype: { name: 'Build' }, customfield_10110: 'VAL-1' },
    });
    const { service, jiraClient } = chainService({ chain: ['VAL-1B', 'VAL-1'], getIssue });
    await service.createBuild({ assemblyKey: 'VAL-1B', name: 'Intake', cloneFromBuildKey: 'VAL-10' });
    expect(getIssue).toHaveBeenCalledWith('VAL-10', { fields: ['issuetype', 'customfield_10110'] });
    expect(jiraClient.createIssue).toHaveBeenCalled();
  });

  it.each([
    ['another Assembly', { issuetype: { name: 'Build' }, customfield_10110: 'VAL-99' }],
    ['a Part', { issuetype: { name: 'Part' }, customfield_10110: 'VAL-1' }],
  ])('refuses a clone source belonging to %s with 400 before creating anything', async (_, fields) => {
    const getIssue = jest.fn().mockResolvedValue({ key: 'VAL-77', fields });
    const { service, jiraClient } = chainService({ getIssue });
    await expect(service.createBuild({ assemblyKey: 'VAL-1', name: 'Intake', cloneFromBuildKey: 'VAL-77' }))
      .rejects.toMatchObject({ status: 400, message: '"VAL-77" isn\'t a Build of this Assembly' });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('turns a 404 clone source into the same 400', async () => {
    const getIssue = jest.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
    const { service, jiraClient } = chainService({ getIssue });
    await expect(service.createBuild({ assemblyKey: 'VAL-1', name: 'Intake', cloneFromBuildKey: 'VAL-77' }))
      .rejects.toMatchObject({ status: 400 });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('writes no OnShape Version Link or Instructions Data on create (B6)', async () => {
    const { service, jiraClient } = chainService();
    await service.createBuild({ assemblyKey: 'VAL-1', name: 'Intake' });
    const [fields] = jiraClient.createIssue.mock.calls[0];
    expect(fields).not.toHaveProperty('customfield_10502');
    expect(fields).not.toHaveProperty('customfield_10503');
  });
});

describe('BuildService.cutVersion writes the OnShape Version Link (B6)', () => {
  it('writes customfield_10502 on the Build', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });
    await service.cutVersion({ buildKey: 'VAL-11', assemblyKey: 'VAL-1', onshapeVersionLink: 'https://cad.onshape.com/v' });
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('VAL-11', { customfield_10502: 'https://cad.onshape.com/v' });
  });
});

describe('BuildService.cloneBuildParts partial failure', () => {
  it('keeps linking past a failed Part and reports it with student text', async () => {
    const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([{ key: 'VAL-50' }, { key: 'VAL-51' }, { key: 'VAL-52' }]),
      createIssueLink: jest.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new JiraApiError('down', 503, '/issueLink'))
        .mockResolvedValueOnce(undefined),
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new BuildService({ jiraClient });
    const result = await service.cloneBuildParts('VAL-10', 'VAL-11');
    warn.mockRestore();
    expect(result.linked).toEqual(['VAL-50', 'VAL-52']);
    expect(result.failed).toEqual([{
      partKey: 'VAL-51',
      error: "the team tracker didn't respond (503)",
      status: 503,
      source: 'tracker',
    }]);
  });

  it('throws when reading the source Build fails', async () => {
    const jiraClient = makeJiraClient({ searchIssues: jest.fn().mockRejectedValue(new Error('search down')) });
    const service = new BuildService({ jiraClient });
    await expect(service.cloneBuildParts('VAL-10', 'VAL-11')).rejects.toThrow('search down');
  });
});

// ---------------------------------------------------------------------------
// INC-4: save, Build statuses, Re-create guards, Cut Version by key
// ---------------------------------------------------------------------------

const { JiraApiError } = await import('../../src/server/clients/jiraClient.js');
const { PartService } = await import('../../src/server/services/partService.js');

const notFound = () => new JiraApiError('Issue does not exist', 404, 'getIssue');
const down = () => new JiraApiError('Service Unavailable', 503, 'endpoint');

/** A jiraClient whose getIssue answers from `issues` by key (404 when absent). */
function fakeJira(issues = {}, overrides = {}) {
  return makeJiraClient({
    getIssue: jest.fn().mockImplementation(async (key, opts) => {
      const entry = issues[key];
      const issue = typeof entry === 'function' ? entry(opts) : entry;
      if (issue instanceof Error) throw issue;
      if (!issue) throw notFound();
      return { key, ...issue };
    }),
    ...overrides,
  });
}

function quietWarn() {
  return jest.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('BuildService.saveBuildParts', () => {
  const BUILD = { fields: { issuetype: { name: 'Build' }, customfield_10110: 'HAR-2030', customfield_10501: 1 } };
  const VALUES = { quantity: 4, material: 'PETG-CF', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' };

  function story(key, fullPartNumber, epic = 'HAR-2030', extra = {}) {
    return { key, fullPartNumber, summary: `${fullPartNumber} Spacer`, epic, ...VALUES, ...extra };
  }
  function create(ref, extra = {}) {
    return { ref, summary: `${ref} Spacer`, revision: ref.slice(-1), ...VALUES, ...extra };
  }
  function partIssue(epic = 'HAR-2030', extra = {}) {
    return { fields: { issuetype: { name: 'Part' }, summary: 'VF27P-0001A Spacer', customfield_10110: epic, issuelinks: [], ...extra } };
  }

  let warn;
  beforeEach(() => { warn = quietWarn(); });
  afterEach(() => warn.mockRestore());

  function setup({
    issues = {}, linked = [], chain = ['HAR-2030'], chainParts = [], byKeys = [], partOverrides = {}, jiraOverrides = {},
  } = {}) {
    // Existing Parts answer an issuelinks read with no links unless a test says otherwise.
    const existing = Object.fromEntries([...chainParts, ...byKeys].map((p) => [p.key, { fields: { issuelinks: [] } }]));
    const jiraClient = fakeJira({ 'HAR-2051': BUILD, ...existing, ...issues }, {
      searchIssues: jest.fn().mockResolvedValue(linked.map((key) => ({ key }))),
      ...jiraOverrides,
    });
    let next = 3000;
    const partService = {
      getStoriesByEpics: jest.fn().mockResolvedValue(chainParts),
      getStoriesByKeys: jest.fn().mockResolvedValue(byKeys),
      createStory: jest.fn().mockImplementation(async () => ({ key: `HAR-${next++}` })),
      updateStory: jest.fn().mockResolvedValue(undefined),
      ...partOverrides,
    };
    const revisionService = { getRevisionChain: jest.fn().mockResolvedValue(chain) };
    const service = new BuildService({ jiraClient, revisionService, partService });
    return { jiraClient, partService, revisionService, service };
  }

  it('throws a 500 without partService and revisionService', async () => {
    const service = new BuildService({ jiraClient: makeJiraClient() });
    await expect(service.saveBuildParts({ buildKey: 'HAR-2051', links: [] }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('refuses a key that is not a Build with 400 and writes nothing', async () => {
    const { service, partService, jiraClient } = setup({ issues: { 'HAR-2051': partIssue() } });
    await expect(service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A')] }))
      .rejects.toMatchObject({ status: 400, message: '"HAR-2051" is not a Build' });
    expect(partService.createStory).not.toHaveBeenCalled();
    expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
  });

  it.each([
    ['the linked-Parts read', { jiraOverrides: { searchIssues: jest.fn().mockRejectedValue(down()) } }],
    ['the chain-Parts read', { partOverrides: { getStoriesByEpics: jest.fn().mockRejectedValue(down()) } }],
  ])('fails before any write when %s fails', async (_, opts) => {
    const { service, partService, jiraClient } = setup(opts);
    await expect(service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A')] }))
      .rejects.toMatchObject({ status: 503 });
    expect(partService.createStory).not.toHaveBeenCalled();
    expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
  });

  it('fails before any write when the chain read fails', async () => {
    const { service, revisionService, partService } = setup();
    revisionService.getRevisionChain.mockRejectedValue(down());
    await expect(service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A')] }))
      .rejects.toMatchObject({ status: 503 });
    expect(partService.createStory).not.toHaveBeenCalled();
  });

  describe('creates', () => {
    it('creates under the Build\'s Assembly and links it, ignoring any client epic', async () => {
      const { service, partService, jiraClient } = setup();
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051', creates: [create('VF27P-0004A', { epic: 'HAR-9' })],
      });
      expect(partService.createStory).toHaveBeenCalledWith(expect.objectContaining({
        summary: 'VF27P-0004A Spacer', epic: 'HAR-2030', revision: 'A', ...VALUES,
      }));
      expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-3000', 'HAR-2051');
      expect(results).toEqual([expect.objectContaining({
        ref: 'VF27P-0004A', op: 'create', ok: true, key: 'HAR-3000', reused: false, linked: true, alreadyLinked: false,
      })]);
    });

    it('skips the issuelinks read for a Part created in this request', async () => {
      const { service, jiraClient } = setup();
      await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A')] });
      expect(jiraClient.getIssue).toHaveBeenCalledTimes(1); // the Build only
    });

    it('reports a link failure after the create with the key and student text', async () => {
      const { service } = setup({ jiraOverrides: { createIssueLink: jest.fn().mockRejectedValue(down()) } });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A')] });
      expect(results[0]).toMatchObject({
        ok: false, key: 'HAR-3000', linked: false, status: 503, source: 'tracker',
        error: "Created, but not added to Build 1: the team tracker didn't respond (503)",
      });
    });

    it('a second save with a link for that key links only', async () => {
      const { service, partService, jiraClient } = setup({ issues: { 'HAR-3000': partIssue() } });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', links: [{ ref: 'r', key: 'HAR-3000' }] });
      expect(partService.createStory).not.toHaveBeenCalled();
      expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-3000', 'HAR-2051');
      expect(results[0]).toMatchObject({ op: 'link', ok: true, linked: true });
    });

    it('reuses a Part number already under the Assembly and reads the chain Parts once', async () => {
      const { service, partService } = setup({
        chainParts: [story('HAR-2031', 'VF27P-0001A')],
      });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051',
        creates: [create('VF27P-0001A'), create('VF27P-0002A'), create('VF27P-0003A')],
      });
      expect(partService.getStoriesByEpics).toHaveBeenCalledTimes(1);
      expect(partService.createStory).toHaveBeenCalledTimes(2);
      expect(results[0]).toMatchObject({ ok: true, key: 'HAR-2031', reused: true, updated: false });
    });

    it('reuses a number held by a Revision A Part on a Revision B Build (chain-wide)', async () => {
      const { service, partService, revisionService } = setup({
        chain: ['HAR-2030B', 'HAR-2030'],
        chainParts: [story('HAR-2031', 'VF27P-0002A', 'HAR-2030')],
      });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0002A')] });
      expect(revisionService.getRevisionChain).toHaveBeenCalledWith('HAR-2030');
      expect(partService.getStoriesByEpics).toHaveBeenCalledWith(['HAR-2030B', 'HAR-2030']);
      expect(partService.createStory).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({ reused: true, key: 'HAR-2031' });
    });

    it('two creates with the same number in one request give one create', async () => {
      const { service, partService } = setup();
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051',
        creates: [create('VF27P-0004A'), { ...create('VF27P-0004A'), ref: 'dup' }],
      });
      expect(partService.createStory).toHaveBeenCalledTimes(1);
      expect(results[1]).toMatchObject({ ok: true, key: 'HAR-3000', reused: true, alreadyLinked: true });
    });

    it('a reused create whose quantity differs updates it with the stored summary', async () => {
      const { service, partService } = setup({
        chainParts: [story('HAR-2031', 'VF27P-0001A', 'HAR-2030', { quantity: 2, summary: 'VF27P-0001A Old Name' })],
      });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0001A')] });
      expect(partService.updateStory).toHaveBeenCalledWith('HAR-2031', { ...VALUES, summary: 'VF27P-0001A Old Name' });
      expect(results[0]).toMatchObject({ ok: true, reused: true, updated: true });
    });

    it('a reused create with identical fields reports updated:false and does not update', async () => {
      const { service, partService } = setup({ chainParts: [story('HAR-2031', 'VF27P-0001A')] });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0001A')] });
      expect(partService.updateStory).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({ reused: true, updated: false });
    });

    it('a reused create whose update fails is not linked', async () => {
      const { service, jiraClient } = setup({
        chainParts: [story('HAR-2031', 'VF27P-0001A', 'HAR-2030', { quantity: 2 })],
        partOverrides: { updateStory: jest.fn().mockRejectedValue(down()) },
      });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0001A')] });
      expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({
        ok: false, key: 'HAR-2031', reused: true,
        error: "Already existed, but couldn't update it: the team tracker didn't respond (503)",
      });
    });

    it('material "Steel" in creates[0] fails that item only; creates[1] is still created', async () => {
      const { service, partService } = setup();
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051',
        creates: [create('VF27P-0004A', { material: 'Steel' }), create('VF27P-0005A')],
      });
      expect(results[0]).toMatchObject({
        ok: false, field: 'material', error: 'Material "Steel" isn\'t on the list. Pick one.',
      });
      expect(partService.createStory).toHaveBeenCalledTimes(1);
      expect(results[1]).toMatchObject({ ok: true, key: 'HAR-3000' });
    });

    it.each([
      ['machinery', { machinery: 'Laser' }],
      ['powdercoat', { powdercoat: 'Pink' }],
      ['thickness', { thickness: '9' }],
      ['quantity', { quantity: 0 }],
    ])('reports %s as the failing field', async (field, extra) => {
      const { service } = setup();
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A', extra)] });
      expect(results[0]).toMatchObject({ ok: false, field });
    });

    it('revision B on a summary with letter A fails with field revision', async () => {
      const { service, partService } = setup();
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051', creates: [create('VF27P-0004A', { revision: 'B' })],
      });
      expect(results[0]).toMatchObject({
        ok: false, field: 'revision',
        error: "Revision B doesn't match the number's letter A in VF27P-0004A",
      });
      expect(partService.createStory).not.toHaveBeenCalled();
    });

    it('a create that fails reports no key', async () => {
      const { service } = setup({ partOverrides: { createStory: jest.fn().mockRejectedValue(down()) } });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A')] });
      expect(results[0]).toMatchObject({ ok: false, key: null, error: "the team tracker didn't respond (503)" });
    });

    it('writes none of the Build fields on the created Part (B6)', async () => {
      const jiraClient = fakeJira({ 'HAR-2051': BUILD }, {
        createIssue: jest.fn().mockResolvedValue({ key: 'HAR-3000' }),
      });
      const revisionService = { getRevisionChain: jest.fn().mockResolvedValue(['HAR-2030']) };
      const partService = new PartService({ jiraClient });
      const service = new BuildService({ jiraClient, revisionService, partService });
      await service.saveBuildParts({ buildKey: 'HAR-2051', creates: [create('VF27P-0004A')] });
      const [fields] = jiraClient.createIssue.mock.calls[0];
      expect(fields).toMatchObject({ summary: 'VF27P-0004A Spacer', customfield_10110: 'HAR-2030' });
      for (const f of ['customfield_10501', 'customfield_10502', 'customfield_10503']) {
        expect(fields).not.toHaveProperty(f);
      }
    });
  });

  describe('updates', () => {
    it('updates with the stored summary, not the client\'s, and links when asked', async () => {
      const { service, partService, jiraClient } = setup({
        byKeys: [story('HAR-2031', 'VF27P-0001A', 'HAR-2030', { summary: 'VF27P-0001A Spacer' })],
        issues: { 'HAR-2031': partIssue() },
      });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051',
        updates: [{ ref: 'HAR-2031', key: 'HAR-2031', summary: 'VF27P-0099A Renamed', ...VALUES, link: true }],
      });
      expect(partService.updateStory).toHaveBeenCalledWith('HAR-2031', { ...VALUES, summary: 'VF27P-0001A Spacer' });
      expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-2031', 'HAR-2051');
      expect(results[0]).toMatchObject({ op: 'update', ok: true, linked: true });
    });

    it('does not link when link is false', async () => {
      const { service, jiraClient } = setup({ byKeys: [story('HAR-2031', 'VF27P-0001A')] });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051', updates: [{ ref: 'a', key: 'HAR-2031', ...VALUES, link: false }],
      });
      expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({ ok: true, linked: false });
    });

    it('a failed update is not linked', async () => {
      const { service, jiraClient } = setup({
        byKeys: [story('HAR-2031', 'VF27P-0001A')],
        partOverrides: { updateStory: jest.fn().mockRejectedValue(down()) },
      });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051', updates: [{ ref: 'a', key: 'HAR-2031', ...VALUES, link: true }],
      });
      expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({ ok: false, status: 503 });
    });

    it('an update and a link for another Assembly\'s Part get "isn\'t a Part of this Assembly" and no write', async () => {
      const { service, partService, jiraClient } = setup({
        byKeys: [story('HAR-500', 'VF27P-0001A', 'HAR-999'), story('HAR-501', 'VF27P-0002A', 'HAR-999')],
      });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051',
        updates: [{ ref: 'a', key: 'HAR-500', ...VALUES }],
        links: [{ ref: 'b', key: 'HAR-501' }],
      });
      expect(results).toEqual([
        expect.objectContaining({ ok: false, error: "HAR-500 isn't a Part of this Assembly" }),
        expect.objectContaining({ ok: false, error: "HAR-501 isn't a Part of this Assembly" }),
      ]);
      expect(partService.updateStory).not.toHaveBeenCalled();
      expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
    });
  });

  describe('links and membership fallback', () => {
    it.each([
      ['a non-Part', { 'HAR-700': { fields: { issuetype: { name: 'Build' }, summary: 'x', customfield_10110: 'HAR-2030' } } }],
      ['a 404', {}],
    ])('a key absent from search whose getIssue is %s is refused', async (_, issues) => {
      const { service, jiraClient } = setup({ issues });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-700' }] });
      expect(results[0]).toMatchObject({ ok: false, error: "HAR-700 isn't a Part of this Assembly" });
      expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
    });

    it('a key absent from search whose getIssue is a chain Part is linked (retry after create)', async () => {
      const { service, jiraClient } = setup({ issues: { 'HAR-3000': partIssue() } });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-3000' }] });
      expect(jiraClient.getIssue).toHaveBeenCalledWith('HAR-3000', {
        fields: ['issuetype', 'summary', 'customfield_10110', 'issuelinks'],
      });
      expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-3000', 'HAR-2051');
      expect(results[0]).toMatchObject({ ok: true, linked: true, alreadyLinked: false });
    });

    it('a 503 on the getIssue fallback fails only that item', async () => {
      const { service, jiraClient } = setup({
        issues: { 'HAR-3000': down(), 'HAR-3001': partIssue() },
      });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-3000' }, { ref: 'b', key: 'HAR-3001' }],
      });
      expect(results[0]).toMatchObject({
        ok: false, status: 503, source: 'tracker', error: "the team tracker didn't respond (503)",
      });
      expect(results[1]).toMatchObject({ ok: true });
      expect(jiraClient.createIssueLink).toHaveBeenCalledTimes(1);
    });

    it('a 400 from the key list switches to by-key checks (M1)', async () => {
      const { service, jiraClient } = setup({
        issues: { 'HAR-2031': partIssue() },
        partOverrides: { getStoriesByKeys: jest.fn().mockRejectedValue(new JiraApiError('bad key', 400, 'search')) },
      });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-999' }, { ref: 'b', key: 'HAR-2031' }],
      });
      expect(results[0]).toMatchObject({ ok: false, error: "HAR-999 isn't a Part of this Assembly" });
      expect(results[1]).toMatchObject({ ok: true, linked: true });
      expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-2031', 'HAR-2051');
    });

    it('a 503 from the key list still fails the request', async () => {
      const { service } = setup({ partOverrides: { getStoriesByKeys: jest.fn().mockRejectedValue(down()) } });
      await expect(service.saveBuildParts({ buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-2031' }] }))
        .rejects.toMatchObject({ status: 503 });
    });

    it('skips a Part the linked-Parts search already lists', async () => {
      const { service, jiraClient } = setup({ linked: ['HAR-2031'], byKeys: [story('HAR-2031', 'VF27P-0001A')] });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-2031' }] });
      expect(results[0]).toMatchObject({ ok: true, alreadyLinked: true });
      expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
    });

    it.each([
      ['outwardIssue', { outwardIssue: { key: 'HAR-2051' } }],
      ['inwardIssue', { inwardIssue: { key: 'HAR-2051' } }],
    ])('an existing "Used In" link reported on the %s side gives alreadyLinked and no new link (M5)', async (_, side) => {
      const { service, jiraClient } = setup({
        byKeys: [story('HAR-2031', 'VF27P-0001A')],
        issues: { 'HAR-2031': { fields: { issuelinks: [{ type: { name: LinkType.USED_IN }, ...side }] } } },
      });
      const { results } = await service.saveBuildParts({ buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-2031' }] });
      expect(jiraClient.getIssue).toHaveBeenCalledWith('HAR-2031', { fields: ['issuelinks'] });
      expect(results[0]).toMatchObject({ ok: true, alreadyLinked: true });
      expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
    });

    it('a failing issuelinks read fails only that item', async () => {
      const { service, jiraClient } = setup({
        byKeys: [story('HAR-2031', 'VF27P-0001A'), story('HAR-2032', 'VF27P-0002A')],
        issues: { 'HAR-2031': down(), 'HAR-2032': { fields: { issuelinks: [] } } },
      });
      const { results } = await service.saveBuildParts({
        buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-2031' }, { ref: 'b', key: 'HAR-2032' }],
      });
      expect(results[0]).toMatchObject({ ok: false, status: 503 });
      expect(results[1]).toMatchObject({ ok: true, linked: true });
      expect(jiraClient.createIssueLink).toHaveBeenCalledTimes(1);
    });

    it('logs each per-item failure once with status and message only', async () => {
      const { service } = setup({ issues: { 'HAR-3000': down() } });
      await service.saveBuildParts({ buildKey: 'HAR-2051', links: [{ ref: 'a', key: 'HAR-3000' }] });
      expect(warn).toHaveBeenCalledWith('[save]', 'HAR-2051', 'link', 'a', 'failed:', 503, 'Service Unavailable');
    });
  });
});

describe('BuildService.getBuildStatuses', () => {
  it('reads each key with getIssue and sorts Builds from missing keys', async () => {
    const jiraClient = fakeJira({
      'HAR-1': { fields: { issuetype: { name: 'Build' }, status: { name: 'Active' }, customfield_10110: 'HAR-2030', customfield_10502: 'https://x/v' } },
      'HAR-2': { fields: { issuetype: { name: 'Part' }, status: { name: 'New' } } },
    }, { searchIssues: jest.fn().mockResolvedValue([buildIssue('HAR-1', { buildNumber: 1, status: 'Draft' })]) });
    const service = new BuildService({ jiraClient });
    const result = await service.getBuildStatuses(['HAR-1', 'HAR-2', 'HAR-3']);
    expect(result).toEqual({
      builds: [{ key: 'HAR-1', status: 'Active', assemblyKey: 'HAR-2030', onshapeVersionLink: 'https://x/v' }],
      missing: ['HAR-2', 'HAR-3'],
    });
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
    expect(jiraClient.getIssue).toHaveBeenCalledWith('HAR-1', {
      fields: ['issuetype', 'status', 'customfield_10110', 'customfield_10502'],
    });
  });

  it('propagates a 503 on one key', async () => {
    const jiraClient = fakeJira({ 'HAR-1': down() });
    const service = new BuildService({ jiraClient });
    await expect(service.getBuildStatuses(['HAR-1'])).rejects.toMatchObject({ status: 503 });
  });
});

describe('BuildService.recreateForBuild guards (INC-4)', () => {
  const TARGET = { fields: { issuetype: { name: 'Build' }, customfield_10110: 'HAR-2030B' } };
  function oldPart(summary = 'VF27P-0003A Bracket', extra = {}) {
    return {
      fields: {
        summary,
        customfield_10500: summary.match(/\d{4}([A-Z])/)[1],
        customfield_10110: 'HAR-2030',
        customfield_10201: [{ value: 'CNC Mill' }],
        customfield_10202: { value: 'AL 6061' },
        customfield_10206: 2,
        project: { key: 'HAR' },
        issuelinks: [],
        ...extra,
      },
    };
  }
  function revisesEntry(side, key, summary) {
    const issue = { key, fields: summary ? { summary } : {} };
    return { type: { name: LinkType.REVISES }, [side]: issue };
  }

  let warn;
  beforeEach(() => { warn = quietWarn(); });
  afterEach(() => warn.mockRestore());

  function setup({ part = oldPart(), issues = {}, chain = ['HAR-2030B', 'HAR-2030'], chainParts = [], revision } = {}) {
    const jiraClient = fakeJira({ 'HAR-2035': part, 'HAR-2052': TARGET, ...issues });
    const revisionService = {
      getRevisionChain: jest.fn().mockResolvedValue(chain),
      createRevision: revision ?? jest.fn().mockResolvedValue({ key: 'HAR-2041', revision: 'B' }),
    };
    const partService = { getStoriesByEpics: jest.fn().mockResolvedValue(chainParts) };
    const service = new BuildService({ jiraClient, revisionService, partService });
    return { jiraClient, revisionService, partService, service };
  }
  const call = (service) => service.recreateForBuild({ partKey: 'HAR-2035', targetBuildKey: 'HAR-2052' });

  it('returns the Part object with revision B, the epic copied and project set', async () => {
    const { service, jiraClient } = setup();
    const result = await call(service);
    expect(result).toEqual({
      key: 'HAR-2041',
      revision: 'B',
      part: expect.objectContaining({
        key: 'HAR-2041', fullPartNumber: 'VF27P-0003B', revision: 'B', epic: 'HAR-2030',
        material: 'AL 6061', machinery: 'CNC Mill', quantity: 2, powdercoat: 'None', thickness: 'None',
        project: expect.any(String),
      }),
    });
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-2041', 'HAR-2052');
  });

  it('accepts a Revision A Part re-created into a Build of Revision B (chain [B, A])', async () => {
    const { service, revisionService } = setup();
    await call(service);
    expect(revisionService.getRevisionChain).toHaveBeenCalledWith('HAR-2030B');
    expect(revisionService.createRevision).toHaveBeenCalled();
  });

  it.each([
    ['outwardIssue'],
    ['inwardIssue'],
  ])('a Revises entry naming a later letter on the %s side gives 409 and no create', async (side) => {
    const { service, revisionService } = setup({
      part: oldPart(undefined, { issuelinks: [revisesEntry(side, 'HAR-2041', 'VF27P-0003B Bracket')] }),
    });
    await expect(call(service)).rejects.toMatchObject({
      status: 409,
      message: 'HAR-2035 was already re-created as HAR-2041. Re-create HAR-2041 instead.',
      details: { recreatedAs: 'HAR-2041' },
    });
    expect(revisionService.createRevision).not.toHaveBeenCalled();
  });

  it.each([['outwardIssue'], ['inwardIssue']])(
    'a B Part whose Revises entry (%s) links the earlier A is not refused',
    async (side) => {
      const { service, revisionService } = setup({
        part: oldPart('VF27P-0003B Bracket', { issuelinks: [revisesEntry(side, 'HAR-2035A', 'VF27P-0003A Bracket')] }),
        revision: jest.fn().mockResolvedValue({ key: 'HAR-2042', revision: 'C' }),
      });
      await call(service);
      expect(revisionService.createRevision).toHaveBeenCalledWith(expect.objectContaining({
        summary: 'VF27P-0003C Bracket',
      }));
    },
  );

  it('ignores a Revises entry with another number or with no summary', async () => {
    const { service, revisionService } = setup({
      part: oldPart(undefined, {
        issuelinks: [
          revisesEntry('outwardIssue', 'HAR-1', 'VF27P-0009B Other'),
          revisesEntry('outwardIssue', 'HAR-2', null),
        ],
      }),
    });
    await call(service);
    expect(revisionService.createRevision).toHaveBeenCalled();
  });

  it.each([
    ['a Part target', { 'HAR-2052': { fields: { issuetype: { name: 'Part' }, customfield_10110: 'HAR-2030B' } } }, 'is not a Build'],
    ['a 404 target', { 'HAR-2052': notFound() }, 'is not a Build'],
  ])('%s gives 400 and no create', async (_, issues, message) => {
    const { service, revisionService } = setup({ issues });
    await expect(call(service)).rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) });
    expect(revisionService.createRevision).not.toHaveBeenCalled();
  });

  it('a target whose chain does not hold the Part\'s Epic Link gives 400 and no create', async () => {
    const { service, revisionService } = setup({ chain: ['HAR-777'] });
    await expect(call(service)).rejects.toMatchObject({
      status: 400, message: '"HAR-2035" isn\'t a Part of this Assembly',
    });
    expect(revisionService.createRevision).not.toHaveBeenCalled();
  });

  it('a failed Revises link carries key, revision, stage and part, keeps 503, and adds no Used In link', async () => {
    const err = Object.assign(down(), { details: { key: 'HAR-2041', revision: 'B', stage: 'revises-link' } });
    const { service, jiraClient } = setup({ revision: jest.fn().mockRejectedValue(err) });
    const caught = await call(service).catch((e) => e);
    expect(caught.status).toBe(503);
    expect(caught.details).toMatchObject({
      key: 'HAR-2041', revision: 'B', stage: 'revises-link',
      part: expect.objectContaining({ key: 'HAR-2041', fullPartNumber: 'VF27P-0003B', revision: 'B' }),
    });
    expect(jiraClient.createIssueLink).not.toHaveBeenCalled();
  });

  it('after a failed Revises link, a second call gives 409 from the recent map and no create', async () => {
    const revision = jest.fn()
      .mockRejectedValueOnce(Object.assign(down(), { details: { key: 'HAR-2041', revision: 'B', stage: 'revises-link' } }));
    const { service } = setup({ revision });
    await call(service).catch(() => {});
    await expect(call(service)).rejects.toMatchObject({ status: 409, details: { recreatedAs: 'HAR-2041' } });
    expect(revision).toHaveBeenCalledTimes(1);
  });

  it('with no recent entry and no Revises link, a chain Part with the new number gives 409', async () => {
    const { service, revisionService } = setup({
      chainParts: [{ key: 'HAR-2041', fullPartNumber: 'VF27P-0003B' }],
    });
    await expect(call(service)).rejects.toMatchObject({ status: 409, details: { recreatedAs: 'HAR-2041' } });
    expect(revisionService.createRevision).not.toHaveBeenCalled();
  });

  it('two concurrent calls give one create', async () => {
    const { service, revisionService } = setup();
    const results = await Promise.allSettled([call(service), call(service)]);
    expect(revisionService.createRevision).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected').reason.status).toBe(409);
  });

  it('a Used In link failure after the create carries stage used-in-link with key and part', async () => {
    const { service, jiraClient } = setup();
    jiraClient.createIssueLink.mockRejectedValue(down());
    const caught = await call(service).catch((e) => e);
    expect(caught.status).toBe(503);
    expect(caught.details).toMatchObject({
      stage: 'used-in-link', key: 'HAR-2041', part: expect.objectContaining({ key: 'HAR-2041' }),
    });
  });
});

describe('BuildService.cutVersionFromOnshape (INC-4)', () => {
  const DOC = 'a'.repeat(24);
  const WS = 'b'.repeat(24);
  const EL = 'c'.repeat(24);
  const OTHER_DOC = 'd'.repeat(24);
  const STORED = `https://cad.onshape.com/documents/${DOC}/v/v0/e/${EL}`;

  let warn;
  beforeEach(() => { warn = quietWarn(); });
  afterEach(() => warn.mockRestore());

  function setup({ build = {}, assembly = {}, siblings = [], statuses = {}, jiraOverrides = {} } = {}) {
    const state = {
      'HAR-2052': {
        issuetype: { name: 'Build' }, status: { name: 'Draft' }, customfield_10110: 'HAR-2030',
        customfield_10502: null, customfield_10501: 2, ...build,
      },
    };
    const issues = {
      'HAR-2052': () => ({ fields: state['HAR-2052'] }),
      'HAR-2030': { fields: { issuetype: { name: 'Epic' }, customfield_10300: DOC, customfield_10301: WS, customfield_10302: EL, ...assembly } },
      ...Object.fromEntries(Object.entries(statuses).map(([k, v]) => [k, v instanceof Error ? v : { fields: { status: { name: v } } }])),
    };
    const jiraClient = fakeJira(issues, {
      searchIssues: jest.fn().mockResolvedValue(siblings.map((k) => buildIssue(k, { buildNumber: 1, status: 'Draft', assemblyKey: 'HAR-2030' }))),
      updateIssue: jest.fn().mockImplementation(async (key, fields) => { Object.assign(state[key], fields); }),
      transitionIssue: jest.fn().mockImplementation(async (key, id) => {
        if (key === 'HAR-2052' && id === BuildTransition.CUT_VERSION) state[key].status = { name: 'Active' };
      }),
      ...jiraOverrides,
    });
    const onshapeClient = makeOnshapeClient();
    const service = new BuildService({ jiraClient, onshapeClient });
    return { jiraClient, onshapeClient, service, state };
  }
  const cut = (service, assemblyKey = 'HAR-2030') => service.cutVersionFromOnshape({ buildKey: 'HAR-2052', assemblyKey });

  it('versions the Assembly\'s stored document, not ids from the request', async () => {
    const { service, onshapeClient, jiraClient } = setup();
    const result = await service.cutVersionFromOnshape({
      buildKey: 'HAR-2052', assemblyKey: 'HAR-2030', documentId: OTHER_DOC, workspaceId: OTHER_DOC, elementId: OTHER_DOC,
    });
    expect(onshapeClient.createVersion).toHaveBeenCalledWith(DOC, WS, expect.objectContaining({ name: 'HAR-2052' }));
    const link = `https://cad.onshape.com/documents/${DOC}/v/v123/e/${EL}`;
    expect(result).toEqual({ onshapeVersionLink: link, superseded: [], resumed: false });
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('HAR-2052', { customfield_10502: link });
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('HAR-2052', BuildTransition.CUT_VERSION);
  });

  it('an Assembly with no document id gives 400 and no version', async () => {
    const { service, onshapeClient } = setup({ assembly: { customfield_10300: null } });
    await expect(cut(service)).rejects.toMatchObject({ status: 400, message: 'This Assembly has no OnShape link.' });
    expect(onshapeClient.createVersion).not.toHaveBeenCalled();
  });

  it('a Build of another Assembly gives 400 before any write', async () => {
    const { service, onshapeClient, jiraClient } = setup({ build: { customfield_10110: 'HAR-999' } });
    await expect(cut(service)).rejects.toMatchObject({ status: 400, message: '"HAR-2052" isn\'t a Build of this Assembly' });
    expect(onshapeClient.createVersion).not.toHaveBeenCalled();
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  });

  it('a key that is not a Build gives 400', async () => {
    const { service } = setup({ build: { issuetype: { name: 'Part' } } });
    await expect(cut(service)).rejects.toMatchObject({ status: 400, message: '"HAR-2052" is not a Build' });
  });

  it('a Superseded Build gives 409 with buildStatus and no version', async () => {
    const { service, onshapeClient } = setup({ build: { status: { name: 'Superseded' } } });
    await expect(cut(service)).rejects.toMatchObject({
      status: 409, message: 'Build 2 has already been cut.', details: { buildStatus: 'Superseded' },
    });
    expect(onshapeClient.createVersion).not.toHaveBeenCalled();
  });

  it('an Active Build without a stored link of this document gives 409 Active', async () => {
    const { service, onshapeClient } = setup({
      build: { status: { name: 'Active' }, customfield_10502: `https://cad.onshape.com/documents/${OTHER_DOC}/v/v1/e/${EL}` },
    });
    await expect(cut(service)).rejects.toMatchObject({ status: 409, details: { buildStatus: 'Active' } });
    expect(onshapeClient.createVersion).not.toHaveBeenCalled();
  });

  it('an Active Build with this document\'s link resumes: supersede only', async () => {
    const { service, onshapeClient, jiraClient } = setup({
      build: { status: { name: 'Active' }, customfield_10502: STORED },
      siblings: ['HAR-2051'], statuses: { 'HAR-2051': 'Active' },
    });
    const result = await cut(service);
    expect(result).toEqual({ onshapeVersionLink: STORED, superseded: ['HAR-2051'], resumed: true });
    expect(onshapeClient.createVersion).not.toHaveBeenCalled();
    expect(jiraClient.transitionIssue).not.toHaveBeenCalledWith('HAR-2052', BuildTransition.CUT_VERSION);
    expect(jiraClient.transitionIssue).toHaveBeenCalledTimes(1);
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('HAR-2051', BuildTransition.SUPERSEDE);
  });

  it('supersedes a sibling that search reports Draft but getIssue reports Active', async () => {
    const { service, jiraClient } = setup({ siblings: ['HAR-2051'], statuses: { 'HAR-2051': 'Active' } });
    const result = await cut(service);
    expect(result.superseded).toEqual(['HAR-2051']);
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('HAR-2051', BuildTransition.SUPERSEDE);
  });

  it('two concurrent calls make one version; the second resumes with nothing superseded', async () => {
    const { service, onshapeClient } = setup();
    const [first, second] = await Promise.all([cut(service), cut(service)]);
    expect(onshapeClient.createVersion).toHaveBeenCalledTimes(1);
    expect(first.resumed).toBe(false);
    expect(second).toMatchObject({ resumed: true, superseded: [] });
  });

  it('a Draft Build with this document\'s link already stored skips the version and still transitions', async () => {
    const { service, onshapeClient, jiraClient } = setup({ build: { customfield_10502: STORED } });
    const result = await cut(service);
    expect(onshapeClient.createVersion).not.toHaveBeenCalled();
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('HAR-2052', BuildTransition.CUT_VERSION);
    expect(result).toMatchObject({ onshapeVersionLink: STORED, resumed: true });
  });

  it.each([
    ['link', { updateIssue: jest.fn().mockRejectedValue(down()) }, {}],
    ['transition', { transitionIssue: jest.fn().mockRejectedValue(down()) }, {}],
    ['supersede', {}, { siblings: ['HAR-2051'], statuses: { 'HAR-2051': down() } }],
  ])('tags a failure in the %s stage with cutStage and the link', async (stage, jiraOverrides, opts) => {
    const { service } = setup({ jiraOverrides, ...opts });
    const caught = await cut(service).catch((e) => e);
    expect(caught.status).toBe(503);
    expect(caught.details).toEqual({
      cutStage: stage, onshapeVersionLink: `https://cad.onshape.com/documents/${DOC}/v/v123/e/${EL}`,
    });
  });

  it('tags a failed Supersede transition as supersede', async () => {
    const { service, jiraClient } = setup({ siblings: ['HAR-2051'], statuses: { 'HAR-2051': 'Active' } });
    jiraClient.transitionIssue.mockImplementation(async (key) => { if (key === 'HAR-2051') throw down(); });
    const caught = await cut(service).catch((e) => e);
    expect(caught.details.cutStage).toBe('supersede');
  });

  it('a createVersion failure carries no cutStage', async () => {
    const { service, onshapeClient, jiraClient } = setup();
    onshapeClient.createVersion.mockRejectedValue(Object.assign(new Error('onshape down'), { status: 500 }));
    const caught = await cut(service).catch((e) => e);
    expect(caught.details?.cutStage).toBeUndefined();
    expect(jiraClient.updateIssue).not.toHaveBeenCalled();
  });

  it('the sibling search failing after the transition gives cutStage supersede with the link', async () => {
    const { service, jiraClient } = setup();
    jiraClient.searchIssues.mockRejectedValue(down());
    const caught = await cut(service).catch((e) => e);
    expect(caught.details).toMatchObject({ cutStage: 'supersede', onshapeVersionLink: expect.stringContaining('/v/v123/') });
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('HAR-2052', BuildTransition.CUT_VERSION);
  });

  it('the sibling search failing on the resume path gives cutStage supersede with the stored link', async () => {
    const { service, jiraClient } = setup({ build: { status: { name: 'Active' }, customfield_10502: STORED } });
    jiraClient.searchIssues.mockRejectedValue(down());
    const caught = await cut(service).catch((e) => e);
    expect(caught.details).toEqual({ cutStage: 'supersede', onshapeVersionLink: STORED });
  });
});
