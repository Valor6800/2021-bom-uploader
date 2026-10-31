import { jest } from '@jest/globals';
import { EpicService } from '../../src/server/services/epicService.js';
import { LinkType, RevisionField } from '../../src/server/utils/buildConstants.js';

/**
 * A new branch of an OnShape tab that is already an Assembly. When the branch
 * carries the same number and a higher Revision, it is a new Assembly: the
 * next Revision of the earlier one, with its own Build 1.
 */
describe('EpicService: a new branch is a new Revision', () => {
  const DOC = '76ec7a909f54ee4dad4571e2';
  const MAIN = 'ede50c305e14429b395bff27';
  const B1 = 'd6deb92e7d7147842bf292a6';
  const B2 = '0123456789abcdef01234567';
  const EL = '1f761e58d2f2d76bcf542d0d';
  const url = (ws, el = EL) => `https://cad.onshape.com/documents/${DOC}/w/${ws}/e/${el}`;

  const savedProject = process.env.PROJECT_KEY;
  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });
  afterAll(() => {
    if (savedProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = savedProject;
  });

  const meta = (values) => ({
    elementType: 1,
    mimeType: 'onshape/assembly',
    properties: Object.entries({
      Name: '57f3fb8efa3416c06701d60d', 'Part number': '57f3fb8efa3416c06701d60f',
      Revision: '57f3fb8efa3416c06701d610', Project: '57f3fb8efa3416c06701d613',
    }).map(([name, propertyId]) => ({ name, propertyId, value: values[name] ?? null })),
  });

  const issue = (key, summary, { ws = MAIN, el = EL, rev = 'A' } = {}) => ({
    key,
    fields: {
      summary,
      issuetype: { name: 'Assembly' },
      status: { name: 'New' },
      created: '2026-10-31T18:00:00.000+0000',
      [RevisionField.REVISION]: rev,
      customfield_10300: DOC,
      customfield_10301: ws,
      customfield_10302: el,
    },
  });

  /**
   * @param {object} opts
   * @param {Record<string, object>} opts.byWorkspace  OnShape properties by workspace id
   * @param {object[]} [opts.existing]                   tracker Assemblies
   */
  function setup({ byWorkspace, existing = [issue('HAR-2049', 'VR27A-1000A Chassis')], linkError = null, bomSubs = [] } = {}) {
    const issues = [...existing];
    let next = 3000;
    const jiraClient = {
      searchIssues: jest.fn(async (jql) => (jql.includes('cf[10302]') || jql.includes('summary ~') ? issues : [])),
      createIssue: jest.fn(async (fields) => {
        const key = `HAR-${next++}`;
        issues.push({
          key,
          fields: { ...fields, issuetype: { name: 'Assembly' }, status: { name: 'New' }, created: new Date().toISOString() },
        });
        return { key };
      }),
      createIssueLink: jest.fn(async () => { if (linkError) throw linkError; }),
      getIssue: jest.fn(async (key) => issues.find((i) => i.key === key)),
    };
    const onshapeClient = {
      baseUrl: 'https://cad.onshape.com',
      getElementMetadata: jest.fn(async (d, ws, el) => meta(byWorkspace[`${ws}:${el}`] ?? byWorkspace[ws])),
      getWorkspaces: jest.fn().mockResolvedValue([{ id: MAIN, name: 'Main' }]),
    };
    const buildService = {
      createBuild: jest.fn(async ({ assemblyKey, name }) => ({
        key: `B-${assemblyKey}`, summary: `${name} Build 1`, assemblyKey, buildNumber: 1, status: 'Draft',
      })),
    };
    const bomService = { getBOMReport: jest.fn(async () => ({ parts: [], unidentified: [], subAssemblies: bomSubs })) };
    const service = new EpicService({ jiraClient, onshapeClient, buildService, bomService });
    return { service, jiraClient, onshapeClient, buildService, issues };
  }

  const main = { Name: 'Chassis', 'Part number': '1000', Revision: 'A', Project: 'VR27' };
  const branchB = { ...main, Revision: 'B' };

  describe('previewOnboarding', () => {
    it('offers a branch with the same number and a higher Revision as a new Revision', async () => {
      const { service, jiraClient } = setup({ byWorkspace: { [MAIN]: main, [B1]: branchB } });
      const result = await service.previewOnboarding(url(B1));
      expect(result.status).toBe('revision');
      expect(result.proposed).toMatchObject({ summary: 'VR27A-1000B Chassis', revision: 'B', workspaceId: B1 });
      expect(result.previous).toMatchObject({ key: 'HAR-2049', summary: 'VR27A-1000A Chassis' });
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('still says exists for the workspace that was added, without reading OnShape', async () => {
      const { service, onshapeClient } = setup({ byWorkspace: { [MAIN]: main } });
      const result = await service.previewOnboarding(url(MAIN));
      expect(result).toMatchObject({ status: 'exists', matchedOn: 'workspace' });
      expect(onshapeClient.getElementMetadata).not.toHaveBeenCalled();
    });

    it('says exists for a branch that is the same Revision', async () => {
      const { service } = setup({ byWorkspace: { [B1]: main } });
      const result = await service.previewOnboarding(url(B1));
      expect(result).toMatchObject({ status: 'exists', matchedOn: 'document' });
      expect(result).not.toHaveProperty('branchMismatch');
    });

    it('says exists, and flags the number, when the branch has a different number', async () => {
      const { service } = setup({ byWorkspace: { [B1]: { ...main, 'Part number': '1100', Revision: 'B' } } });
      const result = await service.previewOnboarding(url(B1));
      expect(result.status).toBe('exists');
      expect(result.branchMismatch.proposed.fullPartNumber).toBe('VR27A-1100B');
    });

    it('says exists when that Revision was already made from this branch', async () => {
      const { service } = setup({
        byWorkspace: { [B1]: branchB },
        existing: [
          issue('HAR-2049', 'VR27A-1000A Chassis'),
          issue('HAR-2060', 'VR27A-1000B Chassis', { ws: B1, rev: 'B' }),
        ],
      });
      const result = await service.previewOnboarding(url(B1));
      expect(result).toMatchObject({ status: 'exists', matchedOn: 'workspace', assembly: { key: 'HAR-2060' } });
    });

    it('says exists when Revision B was made from a different branch', async () => {
      const { service } = setup({
        byWorkspace: { [B2]: branchB },
        existing: [
          issue('HAR-2049', 'VR27A-1000A Chassis'),
          issue('HAR-2060', 'VR27A-1000B Chassis', { ws: B1, rev: 'B' }),
        ],
      });
      const result = await service.previewOnboarding(url(B2));
      expect(result).toMatchObject({ status: 'exists', assembly: { key: 'HAR-2060' } });
    });

    it('falls back to exists when the branch properties cannot be read', async () => {
      const { service } = setup({ byWorkspace: { [B1]: { Name: 'Chassis' } } });
      const result = await service.previewOnboarding(url(B1));
      expect(result).toMatchObject({ status: 'exists', matchedOn: 'document' });
    });
  });

  describe('onboardAssembly', () => {
    it('creates Revision B, links it to the earlier Revision, and makes Build 1', async () => {
      const { service, jiraClient, buildService } = setup({ byWorkspace: { [B1]: branchB } });
      const result = await service.onboardAssembly({ url: url(B1), expectedSummary: 'VR27A-1000B Chassis' });

      expect(result.status).toBe('created');
      expect(result.assembly.summary).toBe('VR27A-1000B Chassis');
      expect(result.revisionOf).toMatchObject({ key: 'HAR-2049' });
      expect(result.revisionLinkError).toBeNull();

      const [fields] = jiraClient.createIssue.mock.calls[0];
      expect(fields).toMatchObject({
        summary: 'VR27A-1000B Chassis',
        [RevisionField.REVISION]: 'B',
        customfield_10301: B1,
        customfield_10302: EL,
      });
      // New Revision revises the earlier one: source is the new ticket.
      expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.REVISES, 'HAR-3000', 'HAR-2049');
      // Build 1, counted on this Revision alone.
      expect(buildService.createBuild).toHaveBeenCalledWith(expect.objectContaining({
        assemblyKey: 'HAR-3000', revisionChainKeys: ['HAR-3000'],
      }));
      expect(result.build).toMatchObject({ buildNumber: 1 });
    });

    it('keeps the new Revision and its Build 1 when the link fails, and says so', async () => {
      const { service, buildService } = setup({
        byWorkspace: { [B1]: branchB },
        linkError: Object.assign(new Error('down'), { status: 503 }),
      });
      const result = await service.onboardAssembly({ url: url(B1), expectedSummary: 'VR27A-1000B Chassis' });
      expect(result.status).toBe('created');
      expect(result.revisionLinkError).toEqual(expect.any(String));
      expect(buildService.createBuild).toHaveBeenCalledTimes(1);
    });

    it('answers 409 with the previous Revision when the name changed since the check', async () => {
      const { service, jiraClient } = setup({ byWorkspace: { [B1]: branchB } });
      await expect(service.onboardAssembly({ url: url(B1), expectedSummary: 'VR27A-1000B Old name' }))
        .rejects.toMatchObject({ status: 409, details: { previous: { key: 'HAR-2049' } } });
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('creates the Revision only once when asked twice', async () => {
      const { service, jiraClient } = setup({ byWorkspace: { [B1]: branchB } });
      await service.onboardAssembly({ url: url(B1), expectedSummary: 'VR27A-1000B Chassis' });
      const again = await service.onboardAssembly({ url: url(B1), expectedSummary: 'VR27A-1000B Chassis' });
      expect(again.status).toBe('exists');
      expect(jiraClient.createIssue).toHaveBeenCalledTimes(1);
    });
  });

  describe('sub-assemblies of a new Revision', () => {
    const SUB = 'abcdefabcdefabcdefabcdef';
    const sub = (ws) => ({
      item: '1', name: 'Base Frame', partNumber: '1100', revision: 'A', project: 'VR27',
      documentId: DOC, elementId: SUB, wvmType: 'w', wvmId: ws,
    });
    const frame = { Name: 'Base Frame', 'Part number': '1100', Revision: 'A', Project: 'VR27' };
    const existing = [
      issue('HAR-2049', 'VR27A-1000A Chassis'),
      issue('HAR-2041', 'VR27A-1100A Base Frame', { el: SUB }),
    ];

    it('reuses a sub-assembly that is still Revision A (taken from 1000A into 1000B)', async () => {
      const { service, jiraClient } = setup({
        byWorkspace: { [B1]: branchB, [`${MAIN}:${SUB}`]: frame },
        existing,
        bomSubs: [sub(MAIN)],
      });
      const result = await service.onboardAssembly({ url: url(B1), expectedSummary: 'VR27A-1000B Chassis' });
      expect(result.subAssemblies).toHaveLength(1);
      expect(result.subAssemblies[0]).toMatchObject({ status: 'exists', assembly: { key: 'HAR-2041' } });
      // Only the new 1000B was created.
      expect(jiraClient.createIssue).toHaveBeenCalledTimes(1);
    });

    it('makes a new Revision of a sub-assembly that OnShape raised to B', async () => {
      const { service, jiraClient } = setup({
        byWorkspace: { [B1]: branchB, [`${B1}:${SUB}`]: { ...frame, Revision: 'B' } },
        existing,
        bomSubs: [sub(B1)],
      });
      const preview = await service.previewOnboarding(url(B1));
      expect(preview.subAssemblies[0]).toMatchObject({
        status: 'revision', proposed: { summary: 'VR27A-1100B Base Frame' }, previous: { key: 'HAR-2041' },
      });

      const result = await service.onboardAssembly({ url: url(B1), expectedSummary: 'VR27A-1000B Chassis' });
      expect(result.subAssemblies[0]).toMatchObject({
        status: 'created', name: 'Base Frame', revisionOf: { key: 'HAR-2041' },
      });
      const links = jiraClient.createIssueLink.mock.calls.map((c) => c.slice(0, 3));
      expect(links).toEqual(expect.arrayContaining([
        [LinkType.REVISES, 'HAR-3000', 'HAR-2049'],
        [LinkType.REVISES, 'HAR-3001', 'HAR-2041'],
      ]));
    });
  });
});
