import { jest } from '@jest/globals';
import { EpicService } from '../../src/server/services/epicService.js';

function makeJiraClient(overrides = {}) {
  return {
    getIssue: jest.fn(),
    ...overrides,
  };
}

describe('EpicService.getEpicByKey', () => {
  it('returns the parsed epic for a matching Assembly issue', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        key: 'VAL-1',
        fields: {
          summary: 'VR26A-0001 End Effector',
          customfield_10300: 'doc1',
          customfield_10301: 'ws1',
          customfield_10302: 'el1',
        },
      }),
    });
    const service = new EpicService({ jiraClient });

    const result = await service.getEpicByKey('VAL-1');

    expect(result).toEqual(expect.objectContaining({
      key: 'VAL-1',
      fullPartNumber: 'VR26A-0001',
      documentId: 'doc1',
      workspaceId: 'ws1',
      elementId: 'el1',
    }));
  });

  it('returns null when the issue summary does not match the Assembly/Part number format', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ key: 'VAL-99', fields: { summary: 'Not an assembly' } }),
    });
    const service = new EpicService({ jiraClient });

    const result = await service.getEpicByKey('VAL-99');

    expect(result).toBeNull();
  });
});
