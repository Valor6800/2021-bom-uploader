import { jest } from '@jest/globals';
import { PartNumbers, blockOf } from '../../src/server/services/partNumbers.js';
import { OnshapeWriter } from '../../src/server/services/onshapeWriter.js';
import { BuildService } from '../../src/server/services/buildService.js';
import { PartService } from '../../src/server/services/partService.js';
import { BOMService, clearBomCache } from '../../src/server/services/bomService.js';
import { LinkType, BuildTransition } from '../../src/server/utils/buildConstants.js';
import { OnshapeProperty } from '../../src/server/utils/onshapeProperties.js';

const partIssue = (key, summary) => ({ key, fields: { summary } });
const trackerWith = (...summaries) => ({
  searchIssues: jest.fn().mockResolvedValue(summaries.map((s, i) => partIssue(`HAR-${100 + i}`, s))),
});

describe('PartNumbers', () => {
  it("works out an Assembly's block from its number", () => {
    expect([blockOf('1100'), blockOf('1000'), blockOf('1130'), blockOf('0000'), blockOf(null), blockOf('12')])
      .toEqual([1100, 1000, 1100, 0, null, null]);
  });

  it('proposes the lowest free numbers in the block, working around the tracker and the BOM', async () => {
    const numbers = new PartNumbers({ jiraClient: trackerWith('VR27P-1101A Plate', 'VR27P-1102B Plate', 'VF27P-1103A Other season', 'VR27P-1201A Other block') });
    expect(await numbers.propose('VR27', 1100, 3, ['1104'])).toEqual(['1103', '1105', '1106']);
    expect(await numbers.propose('VF27', 1100, 2)).toEqual(['1101', '1102']);
    expect(await numbers.propose('VR27', 1000, 2)).toEqual(['1001', '1002']);
  });

  it('never leaves the block: 99 Parts at most', async () => {
    const full = Array.from({ length: 99 }, (_, i) => `VR27P-${1101 + i}A Part`);
    const numbers = new PartNumbers({ jiraClient: trackerWith(...full) });
    await expect(numbers.propose('VR27', 1100, 1)).rejects.toMatchObject({
      status: 400, message: 'Assembly 1100 has used all 99 of its Part numbers.',
    });
  });

  it('claims several numbers at once, keeping the ones still free and in the block', async () => {
    const numbers = new PartNumbers({ jiraClient: trackerWith('VR27P-1102A Plate') });
    expect(await numbers.claim('VR27', 1100, ['1104', '1102', '1203', null])).toEqual(['1104', '1101', '1103', '1105']);
  });

  it('never hands the same number out twice, even before the tracker lists it', async () => {
    const numbers = new PartNumbers({ jiraClient: trackerWith() });
    const [first, second] = await Promise.all([numbers.claim('VR27', 1100, [null, null]), numbers.claim('VR27', 1100, [null])]);
    expect([...first, ...second].sort()).toEqual(['1101', '1102', '1103']);
  });

  it('gives a number back with forget', async () => {
    const numbers = new PartNumbers({ jiraClient: trackerWith() });
    const [n] = await numbers.claim('VR27', 1100, [null]);
    numbers.forget('VR27', n);
    expect(await numbers.claim('VR27', 1100, [null])).toEqual([n]);
  });
});

describe('OnshapeWriter', () => {
  const cad = { documentId: 'd', workspaceId: 'w', elementId: 'e', partId: 'JVD', configuration: 'List_a=X' };
  const assembly = { fields: { summary: 'VR27A-1000A Chassis', customfield_10300: 'd', customfield_10301: 'w', customfield_10302: 'e' } };

  function make(parts, {
    updatePartMetadata = jest.fn().mockResolvedValue({}),
    updatePartsMetadata = jest.fn().mockResolvedValue({ status: 'OK' }),
  } = {}) {
    const bomService = { getBOMReport: jest.fn().mockResolvedValue({ parts, unidentified: [], subAssemblies: [] }) };
    const jiraClient = { getIssue: jest.fn().mockResolvedValue(assembly) };
    const onshapeClient = { updatePartMetadata, updatePartsMetadata };
    return { writer: new OnshapeWriter({ jiraClient, onshapeClient, bomService }), updatePartMetadata, updatePartsMetadata, bomService };
  }

  it('writes the number, Revision A and the season as Project, on the part\'s configuration', async () => {
    const { writer, updatePartMetadata } = make([]);
    await writer.number({ cad, numbering: { prefix: 'VR27', setProject: true } }, '0004');
    expect(updatePartMetadata).toHaveBeenCalledWith({
      ...cad,
      properties: [
        { propertyId: OnshapeProperty.PART_NUMBER, value: '0004' },
        { propertyId: OnshapeProperty.REVISION, value: 'A' },
        { propertyId: OnshapeProperty.PROJECT, value: 'VR27' },
      ],
    });
  });

  it('leaves Project alone when the part already has one', async () => {
    const { writer, updatePartMetadata } = make([]);
    await writer.number({ cad, numbering: { prefix: 'VR27', setProject: false } }, '0004');
    expect(updatePartMetadata.mock.calls[0][0].properties.map((p) => p.propertyId))
      .toEqual([OnshapeProperty.PART_NUMBER, OnshapeProperty.REVISION]);
  });

  it('sorts the BOM into parts to number and numbers to work around', async () => {
    const { writer } = make([
      { numbering: { prefix: 'VR27' }, cadRef: 'ref-1', cad },
      { partNumber: '0007', seasonType: 'R', year: '27', fullPartNumber: 'VR27P-0007A' },
    ]);
    const { byRef, takenByPrefix } = await writer.numberingContext('HAR-1');
    expect([...byRef.keys()]).toEqual(['ref-1']);
    expect(takenByPrefix.get('VR27')).toEqual(['0007']);
  });

  it('writes only the Revisions that differ, to parts the tool may write to', async () => {
    const parts = [
      { fullPartNumber: 'VR27P-0001A', cad, cadRevision: 'A' },
      { fullPartNumber: 'VR27P-0002A', cad: { ...cad, partId: 'J2D' }, cadRevision: '' },
      { fullPartNumber: 'VR27P-0003A', cad: null, cadRevision: 'A' },
    ];
    const { writer, updatePartsMetadata, bomService } = make(parts);
    const wanted = new Map([['R27-0001', 'A'], ['R27-0002', 'B'], ['R27-0003', 'B']]);
    expect(await writer.setRevisions('HAR-1', wanted)).toEqual({ written: 1 });
    expect(updatePartsMetadata).toHaveBeenCalledTimes(1);
    expect(updatePartsMetadata).toHaveBeenCalledWith(expect.objectContaining({ elementId: cad.elementId }), [
      { partId: 'J2D', properties: [{ propertyId: OnshapeProperty.REVISION, value: 'B' }] },
    ]);
    expect(bomService.getBOMReport.mock.calls[0][5]).toEqual({ fresh: true });
  });

  it('writes all of a Part Studio\'s Revisions in one call', async () => {
    const parts = ['J1D', 'J2D', 'J3D'].map((partId, i) => ({ fullPartNumber: `VR27P-000${i + 1}A`, cad: { ...cad, partId }, cadRevision: 'A' }));
    const { writer, updatePartsMetadata } = make(parts);
    const wanted = new Map([['R27-0001', 'B'], ['R27-0002', 'B'], ['R27-0003', 'B']]);
    expect(await writer.setRevisions('HAR-1', wanted)).toEqual({ written: 3 });
    expect(updatePartsMetadata).toHaveBeenCalledTimes(1);
    expect(updatePartsMetadata.mock.calls[0][1].map((i) => i.partId)).toEqual(['J1D', 'J2D', 'J3D']);
  });

  it('names the parts OnShape refused and throws', async () => {
    const refuse = Object.assign(new Error('no'), { name: 'OnshapeApiError', status: 403 });
    const { writer } = make(
      [{ fullPartNumber: 'VR27P-0002A', cad, cadRevision: 'A' }],
      { updatePartsMetadata: jest.fn().mockRejectedValue(refuse) },
    );
    await expect(writer.setRevisions('HAR-1', new Map([['R27-0002', 'B']])))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('VR27P-0002A') });
  });

  it('names a part OnShape answered with an error for, though the call itself went through', async () => {
    const answer = {
      items: [{ href: `https://cad.onshape.com/api/metadata/d/x/w/y/e/z/p/${cad.partId}`, properties: [{ status: 'ERROR', errorMessage: 'locked' }] }],
    };
    const { writer } = make([{ fullPartNumber: 'VR27P-0002A', cad, cadRevision: 'A' }], { updatePartsMetadata: jest.fn().mockResolvedValue(answer) });
    await expect(writer.setRevisions('HAR-1', new Map([['R27-0002', 'B']])))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('locked') });
  });
});

describe('BOMService numbers the parts that have none', () => {
  const D = 'a'.repeat(24);
  const headers = [
    { propertyName: 'item', name: 'Item', propertyId: '5ace8269c046ad612c65a0ba' },
    { propertyName: 'quantity', name: 'Quantity', propertyId: '5ace84d3c046ad611c65a0dd' },
    { propertyName: 'partNumber', name: 'Part number', propertyId: OnshapeProperty.PART_NUMBER },
    { propertyName: 'name', name: 'Name', propertyId: OnshapeProperty.NAME },
    { propertyName: 'material', name: 'Material', propertyId: '57f3fb8efa3416c06701d615' },
    { propertyName: 'revision', name: 'Revision', propertyId: OnshapeProperty.REVISION },
    { propertyName: 'project', name: 'Project', propertyId: OnshapeProperty.PROJECT },
  ];
  const source = (partId, over = {}) => ({ documentId: D, elementId: 'e'.repeat(24), partId, wvmType: 'w', wvmId: 'w'.repeat(24), ...over });
  const row = (over = {}) => ({
    item: '1', quantity: 1, partNumber: '', name: 'Part 4', revision: '', project: '',
    material: { displayName: 'PLA' }, itemSource: source('J1D'), ...over,
  });
  const parse = (items, season = { seasonType: 'R', year: '27' }) =>
    new BOMService({ onshapeClient: {} })._parseBOM({ bomTable: { headers, items } }, 'HAR-1', season, { documentId: D });

  it('turns a row with no number into a part to number, under the Assembly\'s season', () => {
    const { parts, unidentified } = parse([row()]);
    expect(unidentified).toEqual([]);
    expect(parts[0]).toMatchObject({
      fullPartNumber: null, version: 'A', name: 'Part 4',
      numbering: { prefix: 'VR27', setProject: true },
      cad: { documentId: D, partId: 'J1D', workspaceId: 'w'.repeat(24) },
      missing: [],
    });
    expect(parts[0].cadRef).toEqual(expect.stringContaining('J1D'));
  });

  it('uses the part\'s own Project and leaves it alone', () => {
    const { parts } = parse([row({ project: 'VF26' })]);
    expect(parts[0].numbering).toEqual({ prefix: 'VF26', setProject: false });
  });

  it('counts the same OnShape part in two rows once', () => {
    const { parts } = parse([row(), row({ item: '2', quantity: 3 })]);
    expect(parts).toHaveLength(1);
    expect(parts[0].quantity).toBe(4);
  });

  it('leaves a part from another document alone: it is bought, not made', () => {
    const vendor = (over = {}) => row({
      name: 'Robot Battery', partNumber: 'ES17-12', itemSource: source('JHD', { documentId: 'f'.repeat(24), wvmType: 'v' }), ...over,
    });
    const { parts, unidentified, external } = parse([
      vendor(),
      vendor({ item: '2', quantity: 2 }),
      // Even a number that looks like ours does not make it one of our Parts.
      row({ item: '3', name: 'Standoff', partNumber: '0042', project: 'VR27', itemSource: source('JID', { documentId: 'e'.repeat(24) }) }),
    ]);
    expect(parts).toEqual([]);
    expect(unidentified).toEqual([]);
    expect(external).toEqual([
      {
        name: 'Robot Battery', partNumber: 'ES17-12', quantity: 3, sku: null, vendor: null, standard: false,
      },
      {
        name: 'Standoff', partNumber: '0042', quantity: 1, sku: null, vendor: null, standard: false,
      },
    ]);
  });

  it('asks about a part of its own document that is pinned to a version', () => {
    const { parts, unidentified, external } = parse([row({ name: 'Pinned', itemSource: source('JGD', { wvmType: 'v' }) })]);
    expect(parts).toEqual([]);
    expect(external).toEqual([]);
    expect(unidentified).toEqual([expect.objectContaining({ name: 'Pinned', problems: [expect.stringMatching(/pinned to a version/)] })]);
  });

  it('reads a numbered part with no Revision as Revision A, and ignores CAD\'s letter when counting', () => {
    const { parts, unidentified } = parse([
      row({ partNumber: '0007', project: 'VR27', revision: '' }),
      row({ item: '2', partNumber: '0007', project: 'VR27', revision: 'B', quantity: 2 }),
    ]);
    expect(unidentified).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ fullPartNumber: 'VR27P-0007A', quantity: 3, cadRevision: '' });
  });

  it('lists what a part is missing: name and material, never a description', () => {
    const { parts } = parse([row({ name: '', description: '', material: { displayName: '' } })]);
    expect(parts[0].missing).toEqual(['Name', 'Material']);
    expect(parse([row({ description: '' })]).parts[0].missing).toEqual([]);
  });

  it('seeds Powdercoat from the part colour on aluminium, with room for a rough colour', () => {
    const colour = (red, green, blue) => ({ color: { red, green, blue }, opacity: 255, isGenerated: false });
    const { parts } = parse([
      row({ name: 'Dark', itemSource: source('J1D'), material: { displayName: 'Aluminum - 6061' }, appearance: colour(36, 36, 35) }),
      row({ item: '2', name: 'Gold', itemSource: source('J2D'), material: { displayName: 'Aluminum - 6061' }, appearance: colour(212, 175, 55) }),
      row({ item: '3', name: 'Plain', itemSource: source('J3D'), material: { displayName: 'Aluminum - 6061' }, appearance: colour(230, 230, 230) }),
    ]);
    expect(parts.map((p) => [p.name, p.powdercoat])).toEqual([['Dark', 'Black'], ['Gold', 'Gold'], ['Plain', 'None']]);
  });

  it('does not powdercoat a black part that is not aluminium', () => {
    const { parts } = parse([row({ material: { displayName: 'PLA' }, appearance: { color: { red: 10, green: 10, blue: 10 } } })]);
    expect(parts[0].powdercoat).toBe('None');
  });

  it('matches a CAD part to the current Revision of its number', () => {
    const service = new BOMService({ onshapeClient: {} });
    const story = (key, number) => ({ key, fullPartNumber: number, version: number.slice(-1), quantity: 1, material: 'PLA', machinery: 'None', powdercoat: 'None', thickness: 'None' });
    const item = { fullPartNumber: 'VR27P-0001A', quantity: 1, material: 'PLA', machinery: 'None', powdercoat: 'None', thickness: 'None' };
    const { matched, unmatched } = service.compareBOMWithJira([item], [story('HAR-1', 'VR27P-0001A'), story('HAR-2', 'VR27P-0001B')]);
    expect(unmatched).toEqual([]);
    expect(matched[0].story.key).toBe('HAR-2');
  });
});

describe('PartService.previewParts proposes numbers and holds back incomplete parts', () => {
  const cad = { documentId: 'd', workspaceId: 'w', elementId: 'e', partId: 'J1D' };
  const unnumbered = (name, extra = {}) => ({
    fullPartNumber: null, partNumber: null, seasonType: 'R', year: '27', version: 'A', name, quantity: 1,
    material: 'PLA', numbering: { prefix: 'VR27', setProject: true }, cad, cadRef: `ref-${name}`, missing: [], ...extra,
  });

  function make(parts, tracker = [], summary = 'VR27A-1100A Base Frame') {
    const jiraClient = {
      getIssue: jest.fn(async (key, { fields }) => (fields.includes('issuetype')
        ? { fields: { issuetype: { name: 'Epic' } } } : { fields: { summary } })),
      searchIssues: jest.fn().mockResolvedValue(tracker.map((s, i) => partIssue(`HAR-${100 + i}`, s))),
    };
    const bomService = new BOMService({ onshapeClient: {} });
    jest.spyOn(bomService, 'getBOMReport').mockResolvedValue({ parts, unidentified: [], subAssemblies: [] });
    const partNumbers = new PartNumbers({ jiraClient });
    return new PartService({ jiraClient, bomService, partNumbers, revisionService: { getRevisionChain: async () => ['HAR-1'] } });
  }

  it('numbers each new part with the next free number, around the BOM and the tracker', async () => {
    const numbered = { fullPartNumber: 'VR27P-1102A', partNumber: '1102', seasonType: 'R', year: '27', version: 'A', name: 'Plate', quantity: 1, material: 'PLA', missing: [] };
    const preview = await make([unnumbered('Gusset'), numbered, unnumbered('Spacer')], ['VR27P-1101A Old'])
      .previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });
    const gusset = preview.newParts.find((p) => p.name === 'Gusset');
    const spacer = preview.newParts.find((p) => p.name === 'Spacer');
    expect(gusset).toMatchObject({ fullPartNumber: 'VR27P-1103A', summary: 'VR27P-1103A Gusset', proposedNumber: true });
    expect(spacer.fullPartNumber).toBe('VR27P-1104A');
  });

  it('does not number parts under an Assembly that has no number', async () => {
    const preview = await make([unnumbered('Gusset')], [], 'Prototype end effector')
      .previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });
    expect(preview.newParts).toEqual([]);
    expect(preview.unidentified).toEqual([expect.objectContaining({ name: 'Gusset', problems: [expect.stringContaining('no 4-digit number')] })]);
  });

  it('keeps a part missing its material out of the new parts and says why', async () => {
    const preview = await make([unnumbered('Gusset', { missing: ['Material'] }), unnumbered('Spacer')])
      .previewParts({ epicKey: 'HAR-1', documentId: 'd', workspaceId: 'w', elementId: 'e' });
    expect(preview.newParts.map((p) => p.name)).toEqual(['Spacer']);
    expect(preview.newParts[0].fullPartNumber).toBe('VR27P-1101A');
    expect(preview.unidentified).toEqual([expect.objectContaining({ name: 'Gusset', problems: ['missing Material'] })]);
  });
});

describe('BuildService.saveBuildParts numbers new parts', () => {
  const VALUES = { quantity: 2, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' };
  const cad = { documentId: 'd', workspaceId: 'w', elementId: 'e', partId: 'J1D' };
  const bomPart = { name: 'Gusset', seasonType: 'R', year: '27', numbering: { prefix: 'VR27', setProject: true }, cad };
  const item = (extra = {}) => ({ ref: 'VR27P-1103A', summary: 'VR27P-1103A Gusset', revision: 'A', cadRef: 'ref-1', ...VALUES, ...extra });

  function setup({ context, number, tracker = [] } = {}) {
    const issues = {
      'HAR-51': { fields: { issuetype: { name: 'Build' }, status: { name: 'Draft' }, customfield_10110: 'HAR-30', customfield_10501: 1 } },
    };
    const jiraClient = {
      getIssue: jest.fn(async (key) => issues[key]),
      searchIssues: jest.fn().mockResolvedValue(tracker.map((s, i) => partIssue(`HAR-${100 + i}`, s))),
      createIssueLink: jest.fn().mockResolvedValue(undefined),
    };
    const partService = {
      getStoriesByEpics: jest.fn().mockResolvedValue([]),
      getStoriesByKeys: jest.fn().mockResolvedValue([]),
      createStory: jest.fn().mockResolvedValue({ key: 'HAR-3000' }),
    };
    const onshapeWriter = {
      numberingContext: jest.fn().mockResolvedValue(context ?? { byRef: new Map([['ref-1', bomPart]]), takenByPrefix: new Map(), assemblyNumber: '1100' }),
      number: number ?? jest.fn().mockResolvedValue(undefined),
    };
    const partNumbers = new PartNumbers({ jiraClient });
    const service = new BuildService({
      jiraClient, revisionService: { getRevisionChain: async () => ['HAR-30'] }, partService, partNumbers, onshapeWriter,
    });
    return { service, partService, onshapeWriter, jiraClient };
  }

  it('writes the number to OnShape, then makes the Part and links it', async () => {
    const { service, partService, onshapeWriter } = setup();
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item()] });
    expect(onshapeWriter.number).toHaveBeenCalledWith(bomPart, '1103');
    expect(partService.createStory).toHaveBeenCalledWith(expect.objectContaining({ summary: 'VR27P-1103A Gusset', revision: 'A', epic: 'HAR-30' }));
    expect(results[0]).toMatchObject({ ok: true, key: 'HAR-3000', fullPartNumber: 'VR27P-1103A', linked: true });
    const order = [onshapeWriter.number.mock.invocationCallOrder[0], partService.createStory.mock.invocationCallOrder[0]];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it('takes the next free number when the one shown was taken meanwhile', async () => {
    const { service, partService } = setup({ tracker: ['VR27P-1103A Taken'] });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item()] });
    expect(partService.createStory).toHaveBeenCalledWith(expect.objectContaining({ summary: 'VR27P-1101A Gusset' }));
    expect(results[0].fullPartNumber).toBe('VR27P-1101A');
  });

  it('uses the name OnShape has, not the one the client sent', async () => {
    const { service, partService } = setup();
    await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item({ summary: 'VR27P-1103A Something Else' })] });
    expect(partService.createStory).toHaveBeenCalledWith(expect.objectContaining({ summary: 'VR27P-1103A Gusset' }));
  });

  it('makes no Part when OnShape refuses the number, and gives the number back', async () => {
    const refuse = Object.assign(new Error('no'), { name: 'OnshapeApiError', status: 403 });
    const { service, partService } = setup({ number: jest.fn().mockRejectedValue(refuse) });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item()] });
    expect(partService.createStory).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ ok: false, source: 'onshape', error: "Couldn't number it in OnShape: OnShape refused the change (403)" });
  });

  it('says so when the Part could not be made after OnShape took the number', async () => {
    const { service, partService } = setup();
    partService.createStory.mockRejectedValue(Object.assign(new Error('x'), { name: 'JiraApiError', status: 503 }));
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item()] });
    expect(results[0].error).toMatch(/^Numbered VR27P-1103A in OnShape, but couldn't create the Part/);
  });

  it('refuses to number under an Assembly with no number', async () => {
    const { service, onshapeWriter } = setup({
      context: { byRef: new Map([['ref-1', bomPart]]), takenByPrefix: new Map(), assemblyNumber: null },
    });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item()] });
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringContaining('no 4-digit number') });
    expect(onshapeWriter.number).not.toHaveBeenCalled();
  });

  it('refuses a part that is no longer waiting for a number in the BOM', async () => {
    const { service, partService, onshapeWriter } = setup({ context: { byRef: new Map(), takenByPrefix: new Map(), assemblyNumber: '1100' } });
    const { results } = await service.saveBuildParts({ buildKey: 'HAR-51', creates: [item()] });
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringContaining('Update from CAD') });
    expect(onshapeWriter.number).not.toHaveBeenCalled();
    expect(partService.createStory).not.toHaveBeenCalled();
  });
});

describe('BuildService: Revisions follow the tool', () => {
  describe('Cut Version', () => {
    const DOC = 'a'.repeat(24);
    const WS = 'b'.repeat(24);
    const EL = 'c'.repeat(24);

    function setup(setRevisions) {
      const state = { status: { name: 'Draft' }, customfield_10502: null };
      const issues = {
        'HAR-52': () => ({
          fields: {
            issuetype: { name: 'Build' }, customfield_10110: 'HAR-30', customfield_10501: 2, ...state,
            issuelinks: [
              { type: { name: LinkType.USED_IN }, outwardIssue: { key: 'HAR-41', fields: { summary: 'VR27P-0001B Plate' } } },
              { type: { name: LinkType.USED_IN }, outwardIssue: { key: 'HAR-42', fields: { summary: 'VR27P-0002A Gusset' } } },
              { type: { name: LinkType.USED_IN }, outwardIssue: { key: 'HAR-40', fields: { summary: 'VR27P-0001A Plate' } } },
            ],
          },
        }),
        'HAR-30': { fields: { issuetype: { name: 'Assembly' }, customfield_10300: DOC, customfield_10301: WS, customfield_10302: EL } },
      };
      const jiraClient = {
        getIssue: jest.fn(async (key) => (typeof issues[key] === 'function' ? issues[key]() : issues[key])),
        searchIssues: jest.fn().mockResolvedValue([]),
        updateIssue: jest.fn(async (k, f) => Object.assign(state, f)),
        transitionIssue: jest.fn(async (k, id) => { if (id === BuildTransition.CUT_VERSION) state.status = { name: 'Active' }; }),
      };
      const onshapeClient = { baseUrl: 'https://cad.onshape.com', createVersion: jest.fn().mockResolvedValue({ id: 'v1' }) };
      const onshapeWriter = { setRevisions };
      return { service: new BuildService({ jiraClient, onshapeClient, onshapeWriter }), onshapeClient, onshapeWriter };
    }

    it('writes the latest Revision of each Part into OnShape, then cuts the version', async () => {
      const setRevisions = jest.fn().mockResolvedValue({ written: 1 });
      const { service, onshapeClient } = setup(setRevisions);
      await service.cutVersionFromOnshape({ buildKey: 'HAR-52', assemblyKey: 'HAR-30' });
      const [assemblyKey, wanted] = setRevisions.mock.calls[0];
      expect(assemblyKey).toBe('HAR-30');
      expect(Object.fromEntries(wanted)).toEqual({ 'R27-0001': 'B', 'R27-0002': 'A' });
      expect(setRevisions.mock.invocationCallOrder[0]).toBeLessThan(onshapeClient.createVersion.mock.invocationCallOrder[0]);
    });

    it('cuts nothing when OnShape will not take the Revisions', async () => {
      const setRevisions = jest.fn().mockRejectedValue(Object.assign(new Error('OnShape wouldn\'t change it. Nothing was cut.'), { status: 502 }));
      const { service, onshapeClient } = setup(setRevisions);
      await expect(service.cutVersionFromOnshape({ buildKey: 'HAR-52', assemblyKey: 'HAR-30' }))
        .rejects.toMatchObject({ status: 502 });
      expect(onshapeClient.createVersion).not.toHaveBeenCalled();
    });
  });
});

afterEach(() => clearBomCache());
