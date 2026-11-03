import { jest } from '@jest/globals';
import { EpicService } from '../../src/server/services/epicService.js';

describe('EpicService.getPurchasedParts', () => {
  const DOC = 'a'.repeat(24);
  const WS = 'b'.repeat(24);
  const EL = 'c'.repeat(24);
  const VER = 'd'.repeat(24);
  const BATTERY = { name: 'Robot Battery', partNumber: 'ES17-12', quantity: 1 };

  const savedProject = process.env.PROJECT_KEY;
  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });
  afterAll(() => {
    if (savedProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = savedProject;
  });

  const assembly = {
    key: 'HAR-2075',
    fields: {
      summary: 'VR27A-1100A Base Frame', issuetype: { name: 'Assembly' }, status: { name: 'New' }, created: '2026-11-01T00:00:00.000+0000',
      customfield_10500: 'A', customfield_10300: DOC, customfield_10301: WS, customfield_10302: EL,
    },
  };
  const build = (over = {}) => ({
    key: 'HAR-2083',
    fields: { issuetype: { name: 'Build' }, customfield_10110: 'HAR-2075', customfield_10502: `https://cad.onshape.com/documents/${DOC}/v/${VER}/e/${EL}`, ...over },
  });

  function setup({ builds = {}, live = { external: [BATTERY] }, cut = { external: [BATTERY] }, liveError } = {}) {
    const jiraClient = {
      getIssue: jest.fn(async (key) => {
        if (key === 'HAR-2075') return assembly;
        if (builds[key]) return builds[key];
        throw Object.assign(new Error('missing'), { status: 404 });
      }),
    };
    const bomService = {
      getBOMReport: jest.fn(async () => { if (liveError) throw liveError; return live; }),
      getVersionReport: jest.fn(async () => cut),
    };
    return { service: new EpicService({ jiraClient, onshapeClient: {}, bomService }), bomService };
  }

  it('reads the live BOM for a Draft or no Build', async () => {
    const { service, bomService } = setup({ builds: { 'HAR-2083': build({ customfield_10502: null }) } });
    expect(await service.getPurchasedParts('HAR-2075', 'HAR-2083')).toEqual({ parts: [BATTERY] });
    expect(await service.getPurchasedParts('HAR-2075')).toEqual({ parts: [BATTERY] });
    expect(bomService.getBOMReport).toHaveBeenCalledWith(null, DOC, WS, EL, { seasonType: 'R', year: '27' });
    expect(bomService.getVersionReport).not.toHaveBeenCalled();
  });

  it("reads a cut Build's own version, so the list is what that Build was made with", async () => {
    const { service, bomService } = setup({ builds: { 'HAR-2083': build() }, live: { external: [] }, cut: { external: [BATTERY] } });
    expect(await service.getPurchasedParts('HAR-2075', 'HAR-2083')).toEqual({ parts: [BATTERY] });
    expect(bomService.getVersionReport).toHaveBeenCalledWith(DOC, VER, EL, { seasonType: 'R', year: '27' });
    expect(bomService.getBOMReport).not.toHaveBeenCalled();
  });

  it("ignores another Assembly's Build, or a Build that does not exist", async () => {
    const { service, bomService } = setup({ builds: { 'HAR-2083': build({ customfield_10110: 'HAR-9999' }) } });
    await service.getPurchasedParts('HAR-2075', 'HAR-2083');
    await service.getPurchasedParts('HAR-2075', 'HAR-1');
    expect(bomService.getVersionReport).not.toHaveBeenCalled();
    expect(bomService.getBOMReport).toHaveBeenCalledTimes(2);
  });

  it('answers an empty list with the reason when the BOM cannot be read', async () => {
    const { service } = setup({ liveError: Object.assign(new Error('x'), { name: 'OnshapeApiError', status: 502 }) });
    const result = await service.getPurchasedParts('HAR-2075');
    expect(result.parts).toEqual([]);
    expect(result.error).toEqual(expect.any(String));
  });
});
