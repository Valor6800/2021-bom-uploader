import { jest } from '@jest/globals';
import { EpicService } from '../../src/server/services/epicService.js';

describe('EpicService.getSubAssemblies (links on the Designer and Assembly pages)', () => {
  const DOC = '76ec7a909f54ee4dad4571e2';
  const MAIN = 'ede50c305e14429b395bff27';
  const B1 = 'd6deb92e7d7147842bf292a6';
  const PARENT_EL = '1f761e58d2f2d76bcf542d0d';
  const EL = { frame: '042a4f74d166ff9d130b5995', bumper: '39ba6b7faead7e36b6a809a0', electrical: 'dbfc048b0b9d3152f430d328' };

  const savedProject = process.env.PROJECT_KEY;
  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });
  afterAll(() => {
    if (savedProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = savedProject;
  });

  const issue = (key, summary, { ws = MAIN, el, rev = 'A', type = 'Assembly' } = {}) => ({
    key,
    fields: {
      summary,
      issuetype: { name: type },
      status: { name: 'New' },
      created: `2026-10-31T18:00:0${key.slice(-1)}.000+0000`,
      customfield_10500: rev,
      customfield_10300: DOC,
      customfield_10301: ws,
      customfield_10302: el,
    },
  });

  const parent = issue('HAR-2049', 'VR27A-1000A Chassis', { el: PARENT_EL });
  const sub = (name, el, extra = {}) => ({
    item: '1', name, partNumber: '1100', revision: 'A', project: 'VR27', documentId: DOC, elementId: el, wvmType: 'w', wvmId: MAIN, ...extra,
  });

  function setup({ issues, subs = [], bomError = null, withBom = true } = {}) {
    const all = issues ?? [parent];
    const jiraClient = {
      getIssue: jest.fn(async (key) => {
        const hit = all.find((i) => i.key === key);
        if (!hit) throw Object.assign(new Error('missing'), { status: 404 });
        return hit;
      }),
      searchIssues: jest.fn(async (jql) => (jql.includes('cf[10302]') ? all : [])),
    };
    const bomService = withBom
      ? { getBOMReport: jest.fn(async () => { if (bomError) throw bomError; return { parts: [], unidentified: [], subAssemblies: subs }; }) }
      : undefined;
    return { service: new EpicService({ jiraClient, onshapeClient: {}, bomService }), bomService, jiraClient };
  }

  it('links each sub-assembly to its own Assembly and marks the one that is not added yet', async () => {
    const { service } = setup({
      issues: [
        parent,
        issue('HAR-2041', 'VR27A-1100A Base Frame', { el: EL.frame }),
        issue('HAR-2051', 'VR27A-1200A Bumper', { el: EL.bumper }),
      ],
      subs: [sub('Base Frame', EL.frame), sub('Bumper', EL.bumper), sub('Electrical', EL.electrical)],
    });
    const { subAssemblies } = await service.getSubAssemblies('HAR-2049');
    expect(subAssemblies.map((s) => [s.name, s.status, s.assembly?.key])).toEqual([
      ['Base Frame', 'exists', 'HAR-2041'],
      ['Bumper', 'exists', 'HAR-2051'],
      ['Electrical', 'missing', undefined],
    ]);
    expect(subAssemblies[0].assembly.summary).toBe('VR27A-1100A Base Frame');
  });

  it('reads the BOM of the Assembly itself, with its season, from the cache', async () => {
    const { service, bomService } = setup();
    await service.getSubAssemblies('HAR-2049');
    expect(bomService.getBOMReport).toHaveBeenCalledWith(null, DOC, MAIN, PARENT_EL, { seasonType: 'R', year: '27' });
  });

  it('picks the Assembly in the workspace the BOM row points at when the tab has two Revisions', async () => {
    const issues = [
      parent,
      issue('HAR-2041', 'VR27A-1100A Base Frame', { el: EL.frame, rev: 'A', ws: MAIN }),
      issue('HAR-2070', 'VR27A-1100B Base Frame', { el: EL.frame, rev: 'B', ws: B1 }),
    ];
    const a = setup({ issues, subs: [sub('Base Frame', EL.frame, { wvmId: MAIN })] });
    expect((await a.service.getSubAssemblies('HAR-2049')).subAssemblies[0].assembly.key).toBe('HAR-2041');

    const b = setup({ issues, subs: [sub('Base Frame', EL.frame, { wvmId: B1, revision: 'B' })] });
    expect((await b.service.getSubAssemblies('HAR-2049')).subAssemblies[0].assembly.key).toBe('HAR-2070');
  });

  it('falls back to the Revision the BOM row shows when it points at a version', async () => {
    const issues = [
      parent,
      issue('HAR-2041', 'VR27A-1100A Base Frame', { el: EL.frame, rev: 'A' }),
      issue('HAR-2070', 'VR27A-1100B Base Frame', { el: EL.frame, rev: 'B', ws: B1 }),
    ];
    const { service } = setup({ issues, subs: [sub('Base Frame', EL.frame, { wvmType: 'v', wvmId: 'f'.repeat(24), revision: 'A' })] });
    expect((await service.getSubAssemblies('HAR-2049')).subAssemblies[0].assembly.key).toBe('HAR-2041');
  });

  it('answers an empty list when there are no sub-assemblies', async () => {
    const { service } = setup({ subs: [] });
    expect(await service.getSubAssemblies('HAR-2049')).toEqual({ subAssemblies: [] });
  });

  it('answers an empty list without OnShape ids or without a BOM reader', async () => {
    const noIds = { ...parent, fields: { ...parent.fields, customfield_10302: null } };
    expect(await setup({ issues: [noIds] }).service.getSubAssemblies('HAR-2049')).toEqual({ subAssemblies: [] });
    expect(await setup({ withBom: false }).service.getSubAssemblies('HAR-2049')).toEqual({ subAssemblies: [] });
  });

  it('reports a BOM it cannot read instead of failing', async () => {
    const { service } = setup({ bomError: Object.assign(new Error('x'), { status: 502 }) });
    const result = await service.getSubAssemblies('HAR-2049');
    expect(result.subAssemblies).toEqual([]);
    expect(result.error).toEqual(expect.any(String));
  });

  it('refuses a key that is not an Assembly with 400, and a missing key with 404', async () => {
    const part = issue('HAR-3000', 'VR27P-0001A Plate', { type: 'Part' });
    await expect(setup({ issues: [parent, part] }).service.getSubAssemblies('HAR-3000')).rejects.toMatchObject({ status: 400 });
    await expect(setup().service.getSubAssemblies('HAR-9999')).rejects.toMatchObject({ status: 404 });
  });
});
