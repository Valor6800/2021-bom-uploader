/**
 * Link direction, end to end through the real JiraClient: the services'
 * links must read the right way round in the tracker, judged by a model of
 * Jira's own labelling rule (see __tests__/mocks/jiraLinkModel.js) rather
 * than by which argument the code passed first.
 */
import { jest } from '@jest/globals';
import { makeJiraLinkModel } from '../mocks/jiraLinkModel.js';

const model = makeJiraLinkModel();
const fields = new Map();
let nextKey = 9001;

jest.unstable_mockModule('jira.js', () => ({
  Version2Client: class {
    constructor() {
      this.issueLinks = { linkIssues: (p) => model.linkIssues(p) };
      this.issues = {
        createIssue: async ({ fields: f }) => {
          const key = `HAR-${nextKey++}`;
          fields.set(key, f);
          return { key };
        },
        getIssue: async ({ issueIdOrKey }) => ({
          key: issueIdOrKey,
          fields: { ...(fields.get(issueIdOrKey) ?? {}), issuelinks: model.issuelinksOf(issueIdOrKey) },
        }),
      };
    }
  },
}));

const { JiraClient } = await import('../../src/server/clients/jiraClient.js');
const { BuildService } = await import('../../src/server/services/buildService.js');
const { RevisionService } = await import('../../src/server/services/revisionService.js');
const { RevisionField } = await import('../../src/server/utils/buildConstants.js');

const jiraClient = new JiraClient({ host: 'https://jira.test', bearerToken: 'tok' });

describe('issue link direction (Jira labelling model)', () => {
  it('a Part linked into a Build reads "Build uses Part" / "Part is used in Build"', async () => {
    const service = new BuildService({ jiraClient });
    await service.linkPartToBuild('HAR-2031', 'HAR-2032');

    expect(model.reads('HAR-2032')).toContain('HAR-2032 uses HAR-2031');
    expect(model.reads('HAR-2031')).toContain('HAR-2031 is used in HAR-2032');
  });

  it('a new revision "revises" the one it replaces, and the chain walks back to it', async () => {
    fields.set('HAR-3000', { [RevisionField.REVISION]: 'A', project: { key: 'HAR' } });
    const revisions = new RevisionService({ jiraClient });

    const { key: b } = await revisions.createRevision({
      previousKey: 'HAR-3000', issueTypeName: 'Part', summary: 'VF27P-0001B Bracket',
    });
    const { key: c } = await revisions.createRevision({
      previousKey: b, issueTypeName: 'Part', summary: 'VF27P-0001C Bracket',
    });

    expect(model.reads(b)).toEqual([`${b} revises HAR-3000`, `${b} is revised by ${c}`]);
    expect(model.reads('HAR-3000')).toEqual([`HAR-3000 is revised by ${b}`]);
    // From the middle revision the walk goes back, never forward to C.
    await expect(revisions.getRevisionChain(b)).resolves.toEqual([b, 'HAR-3000']);
    await expect(revisions.getRevisionChain(c)).resolves.toEqual([c, b, 'HAR-3000']);
  });
});
