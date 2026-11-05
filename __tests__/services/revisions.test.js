import { jest } from '@jest/globals';
import { PartDiff, sameShape } from '../../src/server/services/partDiff.js';
import { PartService } from '../../src/server/services/partService.js';
import { BuildService } from '../../src/server/services/buildService.js';
import { BOMService } from '../../src/server/services/bomService.js';
import { PartNumbers } from '../../src/server/services/partNumbers.js';
import { LinkType } from '../../src/server/utils/buildConstants.js';

const D = 'a'.repeat(24);
const V = 'b'.repeat(24);
const E = 'c'.repeat(24);
const LINK = `https://cad.onshape.com/documents/${D}/v/${V}/e/${E}`;

const shape = (over = {}) => ({ volume: 1e-4, periphery: 0.2, mass: 0.27, principalInertia: [1e-3, 2e-3, 3e-3], ...over });

describe('sameShape', () => {
  it('treats numeric noise as the same shape', () => {
    expect(sameShape(shape(), shape({ volume: 1e-4 * (1 + 1e-6) }))).toBe(true);
  });
  it('has room for a tiny difference (0.005%) but not a real edit (0.02%)', () => {
    expect(sameShape(shape(), shape({ volume: 1e-4 * (1 + 5e-5) }))).toBe(true);
    expect(sameShape(shape(), shape({ volume: 1e-4 * (1 + 2e-4) }))).toBe(false);
  });
  it('sees a real edit in any of the numbers', () => {
    expect(sameShape(shape(), shape({ volume: 0.99e-4 }))).toBe(false);
    expect(sameShape(shape(), shape({ periphery: 0.21 }))).toBe(false);
    expect(sameShape(shape(), shape({ principalInertia: [1e-3, 2e-3, 3.1e-3] }))).toBe(false);
  });
  it('takes its tolerance from the call, and from PART_DIFF_TOLERANCE by default', () => {
    const nearly = shape({ volume: 1e-4 * (1 + 5e-4) });
    expect(sameShape(shape(), nearly, 1e-3)).toBe(true);
    expect(sameShape(shape(), nearly)).toBe(false);
    process.env.PART_DIFF_TOLERANCE = '0.001';
    try {
      expect(sameShape(shape(), nearly)).toBe(true);
    } finally {
      delete process.env.PART_DIFF_TOLERANCE;
    }
  });
});

describe('PartDiff.baseline', () => {
  const build = (key, status, number, assembly, link = LINK) => ({
    key,
    fields: { status: { name: status }, customfield_10110: assembly, customfield_10501: number, customfield_10502: link },
  });
  const make = (builds) => new PartDiff({
    jiraClient: { searchIssues: jest.fn().mockResolvedValue(builds) }, onshapeClient: {}, bomService: {},
  });

  it('is the newest Revision\'s highest cut Build, and ignores Drafts and Builds without a version', async () => {
    const diff = make([
      build('HAR-1', 'Superseded', 1, 'HAR-A'),
      build('HAR-2', 'Active', 2, 'HAR-A'),
      build('HAR-3', 'Draft', 3, 'HAR-A', null),
      build('HAR-9', 'Active', 5, 'HAR-OLD'),
    ]);
    expect(await diff.baseline(['HAR-A', 'HAR-OLD'])).toEqual({
      buildKey: 'HAR-2', buildNumber: 2, documentId: D, versionId: V, elementId: E,
    });
  });

  it('falls back to an earlier Revision\'s cut Build', async () => {
    const diff = make([build('HAR-9', 'Active', 5, 'HAR-OLD'), build('HAR-3', 'Draft', 1, 'HAR-A', null)]);
    expect((await diff.baseline(['HAR-A', 'HAR-OLD'])).buildKey).toBe('HAR-9');
  });

  it('is null before anything has been cut', async () => {
    expect(await make([build('HAR-3', 'Draft', 1, 'HAR-A', null)]).baseline(['HAR-A'])).toBeNull();
  });
});

describe('PartDiff.changedNumbers', () => {
  const part = (number, over = {}) => ({
    fullPartNumber: `VR27P-${number}A`, material: 'AL 6061',
    origin: { wvmType: 'w', wvmId: 'w', partId: number, microversionId: 'now' }, ...over,
  });
  const then = (number, over = {}) => ({
    fullPartNumber: `VR27P-${number}A`, material: 'AL 6061',
    origin: { wvmType: 'v', wvmId: V, partId: number, microversionId: 'cut' }, ...over,
  });

  function make({ before, shapes }) {
    // One read per Part Studio; a part it can't measure is missing from the answer.
    const onshapeClient = {
      getPartStudioShapes: jest.fn(async (studio, partIds) => new Map(partIds
        .map((id) => [id, shapes[`${studio.wvmType}:${id}`]])
        .filter(([, value]) => value && !(value instanceof Error)))),
    };
    const bomService = { getVersionReport: jest.fn().mockResolvedValue({ parts: before }) };
    return { diff: new PartDiff({ jiraClient: {}, onshapeClient, bomService }), onshapeClient };
  }
  const baseline = { documentId: D, versionId: V, elementId: E };

  it('compares shapes even when the Part Studio version id is the same: it says nothing about one part', async () => {
    const { diff, onshapeClient } = make({
      before: [then('1101', { origin: { ...then('1101').origin, microversionId: 'same' } })],
      shapes: { 'w:1101': shape({ volume: 2e-4 }), 'v:1101': shape() },
    });
    const changed = await diff.changedNumbers(baseline, [part('1101', { origin: { ...part('1101').origin, microversionId: 'same' } })], null);
    expect([...changed]).toEqual(['R27-1101']);
    expect(onshapeClient.getPartStudioShapes).toHaveBeenCalledTimes(2);
  });

  it('ignores a difference inside the tolerance', async () => {
    const { diff } = make({
      before: [then('1101')],
      shapes: { 'w:1101': shape({ volume: 1e-4 * (1 + 3e-5) }), 'v:1101': shape() },
    });
    expect([...await diff.changedNumbers(baseline, [part('1101')], null)]).toEqual([]);
  });

  it("fetches a cut version's shape once, and a workspace shape once per Part Studio version", async () => {
    const { diff, onshapeClient } = make({ before: [then('1101')], shapes: { 'w:1101': shape(), 'v:1101': shape() } });
    await diff.changedNumbers(baseline, [part('1101')], null);
    await diff.changedNumbers(baseline, [part('1101')], null);
    expect(onshapeClient.getPartStudioShapes).toHaveBeenCalledTimes(2);
    await diff.changedNumbers(baseline, [part('1101', { origin: { ...part('1101').origin, microversionId: 'edited' } })], null);
    expect(onshapeClient.getPartStudioShapes).toHaveBeenCalledTimes(3);
  });

  it('reads all the parts of a Part Studio in one call, now and at the cut', async () => {
    const { diff, onshapeClient } = make({
      before: [then('1101'), then('1102'), then('1103')],
      shapes: { 'w:1101': shape(), 'v:1101': shape(), 'w:1102': shape(), 'v:1102': shape(), 'w:1103': shape(), 'v:1103': shape() },
    });
    await diff.changedNumbers(baseline, [part('1101'), part('1102'), part('1103')], null);
    expect(onshapeClient.getPartStudioShapes).toHaveBeenCalledTimes(2);
    expect(onshapeClient.getPartStudioShapes.mock.calls.map(([, ids]) => ids)).toEqual([['1101', '1102', '1103'], ['1101', '1102', '1103']]);
  });

  it('compares shapes when the Part Studio changed, and flags only the Part whose shape moved', async () => {
    const { diff } = make({
      before: [then('1101'), then('1102')],
      shapes: { 'w:1101': shape(), 'v:1101': shape(), 'w:1102': shape({ volume: 2e-4 }), 'v:1102': shape() },
    });
    const changed = await diff.changedNumbers(baseline, [part('1101'), part('1102')], null);
    expect([...changed]).toEqual(['R27-1102']);
  });

  it('counts a changed material as a change without comparing shapes', async () => {
    const { diff, onshapeClient } = make({ before: [then('1101')], shapes: {} });
    const changed = await diff.changedNumbers(baseline, [part('1101', { material: 'AL 7075' })], null);
    expect([...changed]).toEqual(['R27-1101']);
    expect(onshapeClient.getPartStudioShapes).not.toHaveBeenCalled();
  });

  it('ignores a Part that was not in the cut Build: that one is new, not changed', async () => {
    const { diff } = make({ before: [then('1101')], shapes: {} });
    const changed = await diff.changedNumbers(baseline, [part('1109')], null);
    expect([...changed]).toEqual([]);
  });

  it('counts a Part it cannot compare as changed, so a stale Part never ships', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { diff } = make({ before: [then('1101')], shapes: { 'w:1101': new Error('boom'), 'v:1101': shape() } });
    const changed = await diff.changedNumbers(baseline, [part('1101')], null);
    expect([...changed]).toEqual(['R27-1101']);
    warn.mockRestore();
  });
});

describe('PartService.previewParts turns a changed Part into the next Revision', () => {
  const row = (number, extra = {}) => ({
    fullPartNumber: `VR27P-${number}A`, partNumber: number, seasonType: 'R', year: '27', version: 'A', name: 'Tube',
    quantity: 2, material: 'AL 6061', machinery: 'None', powdercoat: 'None', thickness: 'None', missing: [], ...extra,
  });
  const ticket = (key, summary, extra = {}) => ({
    key,
    fields: {
      summary, customfield_10110: 'HAR-1', customfield_10202: { value: 'AL 6061' }, customfield_10201: [{ value: 'CNC Mill' }],
      customfield_10204: { value: 'Black' }, customfield_10206: 2, customfield_10207: { value: '0.125' }, priority: { name: 'High' }, ...extra,
    },
  });

  function make({ changed, cutBuild = true, baseline = { buildKey: 'HAR-50', buildNumber: 1 } }) {
    const links = cutBuild ? [{ type: { name: LinkType.USED_IN }, inwardIssue: { key: 'HAR-50' } }] : [];
    const jiraClient = {
      getIssue: jest.fn(async (key, { fields }) => {
        if (key === 'HAR-1') return fields.includes('issuetype') ? { fields: { issuetype: { name: 'Epic' } } } : { fields: { summary: 'VR27A-1100A Base Frame' } };
        if (key === 'HAR-100') return { fields: { issuelinks: links } };
        if (key === 'HAR-50') return { fields: { issuetype: { name: 'Build' }, status: { name: 'Active' }, customfield_10501: 1 } };
        throw Object.assign(new Error('missing'), { status: 404 });
      }),
      searchIssues: jest.fn().mockResolvedValue([ticket('HAR-100', 'VR27P-1101A Tube')]),
    };
    const bomService = new BOMService({ onshapeClient: {} });
    jest.spyOn(bomService, 'getBOMReport').mockResolvedValue({ parts: [row('1101')], unidentified: [], subAssemblies: [] });
    const partDiff = { baseline: jest.fn().mockResolvedValue(baseline), changedNumbers: jest.fn().mockResolvedValue(new Set(changed)) };
    const service = new PartService({
      jiraClient, bomService, partDiff, partNumbers: new PartNumbers({ jiraClient }),
      revisionService: { getRevisionChain: async () => ['HAR-1'] },
    });
    return { service, partDiff };
  }
  const preview = (service) => service.previewParts({ epicKey: 'HAR-1', documentId: D, workspaceId: 'w', elementId: E });

  it('makes a Revision B row for a changed Part a cut Build used, keeping the student\'s choices', async () => {
    const { service } = make({ changed: ['R27-1101'] });
    const result = await preview(service);
    expect(result.existingParts).toEqual([]);
    expect(result.newParts).toHaveLength(1);
    expect(result.newParts[0]).toMatchObject({
      fullPartNumber: 'VR27P-1101B', summary: 'VR27P-1101B Tube', version: 'B', quantity: 2,
      revises: 'HAR-100', replaces: { key: 'HAR-100', fullPartNumber: 'VR27P-1101A', version: 'A' },
      machinery: 'CNC Mill', powdercoat: 'Black', thickness: '0.125', priority: 'High',
    });
    expect(result.baseline).toEqual({ buildKey: 'HAR-50', buildNumber: 1 });
  });

  it('leaves an unchanged Part alone', async () => {
    const { service } = make({ changed: [] });
    const result = await preview(service);
    expect(result.newParts).toEqual([]);
    expect(result.existingParts.map((m) => m.story.key)).toEqual(['HAR-100']);
  });

  it('updates in place a changed Part that no cut Build uses: it is the Draft\'s own', async () => {
    const { service } = make({ changed: ['R27-1101'], cutBuild: false });
    const result = await preview(service);
    expect(result.newParts).toEqual([]);
    expect(result.existingParts.map((m) => m.story.key)).toEqual(['HAR-100']);
  });

  it('checks nothing before a Build has been cut', async () => {
    const { service, partDiff } = make({ changed: ['R27-1101'], baseline: null });
    const result = await preview(service);
    expect(partDiff.changedNumbers).not.toHaveBeenCalled();
    expect(result.existingParts).toHaveLength(1);
    expect(result.baseline).toBeNull();
  });
});

describe('BuildService.saveBuildParts: a new Revision and extra copies', () => {
  const VALUES = { quantity: 2, material: 'AL 6061', machinery: 'CNC Mill', powdercoat: 'Black', thickness: '0.125' };
  const BUILD = { fields: { issuetype: { name: 'Build' }, status: { name: 'Draft' }, customfield_10110: 'HAR-1', customfield_10501: 2 } };
  const oldPart = { key: 'HAR-100', fullPartNumber: 'VR27P-1101A', seasonType: 'R', year: '27', partNumber: '1101', version: 'A', summary: 'VR27P-1101A Tube', epic: 'HAR-1', ...VALUES };

  function setup({ oldLinks = [], extra = {} } = {}) {
    const jiraClient = {
      getIssue: jest.fn(async (key) => {
        if (key === 'HAR-51') return BUILD;
        if (key === 'HAR-100') return { fields: { issuelinks: oldLinks } };
        throw Object.assign(new Error('missing'), { status: 404 });
      }),
      searchIssues: jest.fn().mockResolvedValue([{ key: 'HAR-100' }]),
      createIssueLink: jest.fn().mockResolvedValue(undefined),
      deleteIssueLink: jest.fn().mockResolvedValue(undefined),
      ...extra,
    };
    let next = 3000;
    const partService = {
      getStoriesByEpics: jest.fn().mockResolvedValue([oldPart]),
      getStoriesByKeys: jest.fn().mockResolvedValue([]),
      createStory: jest.fn(async () => ({ key: `HAR-${next++}` })),
      clonePart: jest.fn(async ({ quantity }) => {
        const key = `HAR-${next++}`;
        return { key, fullPartNumber: 'VR27P-1101A', part: { ...oldPart, key, quantity } };
      }),
    };
    const service = new BuildService({ jiraClient, revisionService: { getRevisionChain: async () => ['HAR-1'] }, partService });
    return { service, jiraClient, partService };
  }
  const create = (extra = {}) => ({ ref: 'VR27P-1101B', summary: 'VR27P-1101B Tube', revision: 'B', revises: 'HAR-100', ...VALUES, ...extra });
  const usedIn = (id) => ({ id, type: { name: LinkType.USED_IN }, inwardIssue: { key: 'HAR-51' } });

  it('makes Revision B, records it as the revision of A, and takes A out of the Build', async () => {
    const { service, jiraClient, partService } = setup({ oldLinks: [usedIn('777')] });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [create()] });
    expect(partService.createStory).toHaveBeenCalledWith(expect.objectContaining({ summary: 'VR27P-1101B Tube', revision: 'B' }));
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-51', 'HAR-3000');
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.REVISES, 'HAR-3000', 'HAR-100');
    expect(jiraClient.deleteIssueLink).toHaveBeenCalledWith('777');
    expect(results[0]).toMatchObject({ ok: true, key: 'HAR-3000', linked: true, replaced: 'HAR-100' });
  });

  it('is fine when A was never in the Build, and repeats nothing on a second Save', async () => {
    const revised = { type: { name: LinkType.REVISES }, outwardIssue: { key: 'HAR-3000' } };
    const { service, jiraClient } = setup({ oldLinks: [revised] });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [create()] });
    expect(jiraClient.deleteIssueLink).not.toHaveBeenCalled();
    expect(jiraClient.createIssueLink).not.toHaveBeenCalledWith(LinkType.REVISES, expect.anything(), expect.anything());
    expect(results[0]).toMatchObject({ ok: true, replaced: 'HAR-100' });
  });

  it('keeps the new Part and says so when A could not be taken out', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = setup({
      oldLinks: [usedIn('777')],
      extra: { deleteIssueLink: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'JiraApiError', status: 503 })) },
    });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [create()] });
    expect(results[0]).toMatchObject({ ok: true, key: 'HAR-3000', replaced: null });
    expect(results[0].note).toBe("Made VR27P-1101B, but couldn't take HAR-100 out of Build 2.");
    warn.mockRestore();
  });

  it('refuses a Revision that does not revise the named Part', async () => {
    const { service, partService } = setup();
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [create({ revises: 'HAR-999' })] });
    expect(results[0]).toMatchObject({ ok: false, field: 'revises' });
    expect(partService.createStory).not.toHaveBeenCalled();
  });

  it('makes the extra units as an exact copy and links it to the Build', async () => {
    const { service, jiraClient, partService } = setup();
    const { results } = await service.saveBuildParts({
      buildKey: 'HAR-51', copies: [{ ref: 'copy:HAR-100', from: 'HAR-100', quantity: 1 }],
    });
    expect(partService.clonePart).toHaveBeenCalledWith({ sourceKey: 'HAR-100', epicKey: 'HAR-1', quantity: 1 });
    expect(jiraClient.createIssueLink).toHaveBeenCalledWith(LinkType.USED_IN, 'HAR-51', 'HAR-3000');
    expect(results[0]).toMatchObject({ op: 'copy', ok: true, key: 'HAR-3000', linked: true, fullPartNumber: 'VR27P-1101A' });
    expect(results[0].part).toMatchObject({ key: 'HAR-3000', quantity: 1 });
  });

  it('refuses a copy of a Part that is not in this Assembly, or with no quantity', async () => {
    const { service, partService } = setup();
    const { results } = await service.saveBuildParts({
      buildKey: 'HAR-51',
      copies: [{ ref: 'a', from: 'HAR-999', quantity: 1 }, { ref: 'b', from: 'HAR-100', quantity: 0 }],
    });
    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(results[1].field).toBe('quantity');
    expect(partService.clonePart).not.toHaveBeenCalled();
  });
});
