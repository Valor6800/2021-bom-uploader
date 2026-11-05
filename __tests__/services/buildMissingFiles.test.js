import { jest } from '@jest/globals';
import { BuildService } from '../../src/server/services/buildService.js';

const LINK = 'https://cad.onshape.com/documents/aaa/v/bbb/e/ccc';

function make({ status = 'Active', link = LINK, stories = [] } = {}) {
  const jiraClient = {
    getIssue: jest.fn().mockResolvedValue({
      fields: { issuetype: { name: 'Build' }, status: { name: status }, customfield_10110: 'HAR-1', customfield_10502: link },
    }),
  };
  const partService = { getStoriesByKeys: jest.fn().mockResolvedValue(stories) };
  const fileJobs = { enqueue: jest.fn().mockReturnValue(true) };
  const service = new BuildService({ jiraClient, partService, fileJobs });
  service.getLinkedParts = jest.fn().mockResolvedValue(stories.map((s) => s.key));
  return { service, partService, fileJobs };
}

const story = (key, fullPartNumber, machinery, files) => ({
  key, fullPartNumber, machinery, files, thickness: '0.250', material: 'AL 6061', tapping: 'No',
});

describe('BuildService.queueMissingFiles', () => {
  it('queues only the Parts missing files, from the Build\'s cut version', async () => {
    const { service, partService, fileJobs } = make({
      stories: [
        story('HAR-10', 'VR26P-0001A', 'CNC Router', ['VR26P-0001A.png', 'VR26P-0001A_drawings.pdf']),
        story('HAR-11', 'VR26P-0002A', 'CNC Mill', ['VR26P-0002A.png', 'VR26P-0002A_drawings.pdf']),
      ],
    });
    const result = await service.queueMissingFiles('HAR-5');
    expect(partService.getStoriesByKeys).toHaveBeenCalledWith(['HAR-10', 'HAR-11'], { files: true });
    expect(result).toEqual({ queued: ['HAR-10'], missing: { 'HAR-10': ['DXF'] } });
    expect(fileJobs.enqueue).toHaveBeenCalledTimes(1);
    expect(fileJobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      key: 'HAR-10', partNumber: 'VR26P-0001A', machinery: 'CNC Router', assemblyKey: 'HAR-1', versionLink: LINK,
    }));
  });

  it('refuses a Draft: its files come at the cut', async () => {
    const { service, fileJobs } = make({ status: 'Draft', link: null });
    await expect(service.queueMissingFiles('HAR-5')).rejects.toMatchObject({ status: 409 });
    expect(fileJobs.enqueue).not.toHaveBeenCalled();
  });

  it('does not report a Part as queued when its job is already running', async () => {
    const { service, fileJobs } = make({ stories: [story('HAR-10', 'VR26P-0001A', 'None', [])] });
    fileJobs.enqueue.mockReturnValue(false);
    expect(await service.queueMissingFiles('HAR-5')).toEqual({ queued: [], missing: { 'HAR-10': ['picture', 'drawing'] } });
  });
});
