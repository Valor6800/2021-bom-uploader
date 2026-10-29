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

    expect(result).toEqual({ key: 'VAL-11', buildNumber: 2 });
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
      documentId: 'd', workspaceId: 'w', elementId: 'e',
    })).rejects.toThrow('requires an onshapeClient');
  });

  it('cuts a real Onshape version, builds the link from it, and runs cutVersion', async () => {
    const jiraClient = makeJiraClient();
    const onshapeClient = makeOnshapeClient();
    const service = new BuildService({ jiraClient, onshapeClient });

    const result = await service.cutVersionFromOnshape({
      buildKey: 'VAL-11',
      assemblyKey: 'VAL-1',
      documentId: 'doc1',
      workspaceId: 'ws1',
      elementId: 'elem1',
    });

    expect(onshapeClient.createVersion).toHaveBeenCalledWith('doc1', 'ws1', {
      name: 'VAL-11',
      description: expect.stringContaining('VAL-11'),
    });

    const expectedLink = 'https://cad.onshape.com/documents/doc1/v/v123/e/elem1';
    expect(result.onshapeVersionLink).toBe(expectedLink);
    expect(jiraClient.updateIssue).toHaveBeenCalledWith('VAL-11', {
      [BuildField.ONSHAPE_VERSION_LINK]: expectedLink,
    });
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('VAL-11', BuildTransition.CUT_VERSION);
  });

  it('still supersedes the previously-Active sibling via the same cutVersion logic', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([
        buildIssue('VAL-10', { buildNumber: 1, status: BuildStatus.ACTIVE, assemblyKey: 'VAL-1' }),
      ]),
    });
    const onshapeClient = makeOnshapeClient();
    const service = new BuildService({ jiraClient, onshapeClient });

    const result = await service.cutVersionFromOnshape({
      buildKey: 'VAL-11', assemblyKey: 'VAL-1',
      documentId: 'doc1', workspaceId: 'ws1', elementId: 'elem1',
    });

    expect(result.superseded).toEqual(['VAL-10']);
    expect(jiraClient.transitionIssue).toHaveBeenCalledWith('VAL-10', BuildTransition.SUPERSEDE);
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
    expect(jql).toContain(`linkedIssues(VAL-11, "${LinkType.USED_IN}")`);
  });
});

describe('BuildService.cloneBuildParts', () => {
  it('links every part from the source build onto the target build', async () => {
    const jiraClient = makeJiraClient({
      searchIssues: jest.fn().mockResolvedValue([{ key: 'VAL-50' }, { key: 'VAL-51' }]),
    });
    const service = new BuildService({ jiraClient });

    const result = await service.cloneBuildParts('VAL-10', 'VAL-11');

    expect(result).toEqual({ linked: ['VAL-50', 'VAL-51'] });
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'VAL-50', 'VAL-11');
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'VAL-51', 'VAL-11');
  });

  it('links nothing when the source build has no parts', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    const result = await service.cloneBuildParts('VAL-10', 'VAL-11');

    expect(result).toEqual({ linked: [] });
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
    expect(jql).toContain(`linkedIssues(VAL-50, "${LinkType.USED_IN}")`);
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
        ...overrides,
      },
    };
  }

  it('throws without a revisionService dependency', async () => {
    const jiraClient = makeJiraClient();
    const service = new BuildService({ jiraClient });

    await expect(service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' }))
      .rejects.toThrow('revisionService');
  });

  it('creates the next revision with carried-forward fields and links it to the target build', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue(makePreviousPartIssue()),
    });
    const revisionService = makeRevisionService();
    const service = new BuildService({ jiraClient, revisionService });

    const result = await service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' });

    expect(result).toEqual({ key: 'VAL-51', revision: 'B' });
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
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue(makePreviousPartIssue({
        customfield_10204: { value: 'Black' },
        customfield_10207: { value: '0.125' },
      })),
    });
    const revisionService = makeRevisionService();
    const service = new BuildService({ jiraClient, revisionService });

    await service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' });

    const [{ extraFields }] = revisionService.createRevision.mock.calls[0];
    expect(extraFields.customfield_10204).toEqual({ value: 'Black' });
    expect(extraFields.customfield_10207).toEqual({ value: '0.125' });
  });

  it('rejects a Part whose summary does not match the part number format', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue(makePreviousPartIssue({ summary: 'not a part number' })),
    });
    const revisionService = makeRevisionService();
    const service = new BuildService({ jiraClient, revisionService });

    await expect(service.recreateForBuild({ partKey: 'VAL-50', targetBuildKey: 'VAL-11' }))
      .rejects.toThrow('Part number format');
  });
});
