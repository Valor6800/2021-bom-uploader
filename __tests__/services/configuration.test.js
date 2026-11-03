import { jest } from '@jest/globals';
import { BOMService } from '../../src/server/services/bomService.js';
import { EpicService } from '../../src/server/services/epicService.js';
import { OnshapeWriter } from '../../src/server/services/onshapeWriter.js';
import { PartService } from '../../src/server/services/partService.js';
import { Pictures } from '../../src/server/services/pictures.js';

const D = 'a'.repeat(24);
const W = 'b'.repeat(24);
const E = 'c'.repeat(24);
const SUB = 'd'.repeat(24);
const CFG = 'List_x=_2x2_Lowered;List_y=Default';
const headers = [
  { propertyName: 'item', name: 'Item', propertyId: '5ace8269c046ad612c65a0ba' },
  { propertyName: 'quantity', name: 'Quantity', propertyId: '5ace84d3c046ad611c65a0dd' },
  { propertyName: 'partNumber', name: 'Part number', propertyId: '57f3fb8efa3416c06701d60f' },
  { propertyName: 'name', name: 'Name', propertyId: '57f3fb8efa3416c06701d60d' },
  { propertyName: 'material', name: 'Material', propertyId: '57f3fb8efa3416c06701d615' },
];
const bomWith = (name) => ({ bomTable: { headers, items: [{ item: '1', quantity: 1, partNumber: '0001', name, material: { displayName: 'PLA' }, project: 'VR27' }] } });

describe('the BOM is read in the Assembly\'s configuration', () => {
  it('asks OnShape for that configuration, and keeps each configuration\'s BOM apart', async () => {
    const getAssemblyBOM = jest.fn(async (d, w, e, options) => bomWith(options.configuration ? 'Lowered' : 'Default'));
    const service = new BOMService({ onshapeClient: { getAssemblyBOM } });
    const season = { seasonType: 'R', year: '27' };
    const lowered = await service.getBOMReport('HAR-1', D, W, E, { ...season, configuration: CFG }, { fresh: true });
    const plain = await service.getBOMReport('HAR-1', D, W, E, season, { fresh: true });
    expect(lowered.parts[0].name).toBe('Lowered');
    expect(plain.parts[0].name).toBe('Default');
    expect(getAssemblyBOM).toHaveBeenNthCalledWith(1, D, W, E, { multiLevel: true, configuration: CFG });
    expect(getAssemblyBOM).toHaveBeenNthCalledWith(2, D, W, E, { multiLevel: true });
    // Cached separately: asking again for each does not mix them up.
    expect((await service.getBOMReport('HAR-1', D, W, E, { ...season, configuration: CFG })).parts[0].name).toBe('Lowered');
    expect((await service.getBOMReport('HAR-1', D, W, E, season)).parts[0].name).toBe('Default');
    expect(getAssemblyBOM).toHaveBeenCalledTimes(2);
  });

  it('reads a cut version in the same configuration', async () => {
    const getAssemblyBOMAtVersion = jest.fn().mockResolvedValue(bomWith('Lowered'));
    const service = new BOMService({ onshapeClient: { getAssemblyBOMAtVersion } });
    await service.getVersionReport(D, 'v'.repeat(24), E, { seasonType: 'R', year: '27', configuration: CFG });
    expect(getAssemblyBOMAtVersion).toHaveBeenCalledWith(D, 'v'.repeat(24), E, { configuration: CFG });
  });

  it('notes the configuration a sub-assembly is used in', () => {
    const service = new BOMService({ onshapeClient: {} });
    const { subAssemblies } = service._parseBOM({
      bomTable: {
        headers,
        items: [{ item: '1', quantity: 1, name: 'Base Frame', partNumber: '1100', itemSource: { documentId: D, elementId: SUB, wvmType: 'w', wvmId: W, configuration: CFG } }],
      },
    }, 'HAR-1', { seasonType: 'R', year: '27' }, { documentId: D });
    expect(subAssemblies[0].configuration).toBe(CFG);
  });
});

describe('Update from CAD follows the Assembly\'s configuration', () => {
  it('reads the configuration from the Assembly description and passes it with the season', async () => {
    const jiraClient = {
      getIssue: jest.fn(async (key, { fields }) => (fields.includes('issuetype')
        ? { fields: { issuetype: { name: 'Epic' } } }
        : { fields: { summary: 'VR27A-1100A Base Frame', description: `Base.\nOnshape configuration: ${CFG}` } })),
      searchIssues: jest.fn().mockResolvedValue([]),
    };
    const bomService = new BOMService({ onshapeClient: {} });
    const getBOMReport = jest.spyOn(bomService, 'getBOMReport').mockResolvedValue({ parts: [], unidentified: [], subAssemblies: [] });
    const service = new PartService({ jiraClient, bomService, revisionService: { getRevisionChain: async () => ['HAR-1'] } });
    await service.previewParts({ epicKey: 'HAR-1', documentId: D, workspaceId: W, elementId: E });
    expect(getBOMReport.mock.calls[0][4]).toEqual({ seasonType: 'R', year: '27', partNumber: '1100', configuration: CFG });
  });
});

describe('numbering and files read the BOM in the configuration', () => {
  it('OnshapeWriter.readBom passes it', async () => {
    const bomService = { getBOMReport: jest.fn().mockResolvedValue({ parts: [], unidentified: [], subAssemblies: [] }) };
    const jiraClient = {
      getIssue: jest.fn().mockResolvedValue({
        fields: { summary: 'VR27A-1100A Base Frame', description: `Onshape configuration: ${CFG}`, customfield_10300: D, customfield_10301: W, customfield_10302: E },
      }),
    };
    await new OnshapeWriter({ jiraClient, onshapeClient: {}, bomService }).readBom('HAR-2084');
    expect(bomService.getBOMReport.mock.calls[0][4]).toEqual({ seasonType: 'R', year: '27', configuration: CFG });
  });
});

describe('Assemblies added from a link', () => {
  const link = (extra = '') => `https://cad.onshape.com/documents/${D}/w/${W}/e/${E}${extra}`;
  const service = () => new EpicService({ jiraClient: {}, onshapeClient: {} });

  it('take the link\'s configuration', () => {
    expect(service().parseOnshapeUrl(link(`?configuration=${encodeURIComponent(CFG)}`))).toEqual({
      documentId: D, workspaceId: W, elementId: E, configuration: CFG,
    });
    expect(service().parseOnshapeUrl(link()).configuration).toBeNull();
  });

  it('store it as a line in the Assembly description, and open OnShape in it', async () => {
    const createIssue = jest.fn().mockResolvedValue({ key: 'HAR-2100' });
    const epic = new EpicService({ jiraClient: { createIssue }, onshapeClient: { baseUrl: 'https://cad.onshape.com' } });
    await epic.createEpic({ summary: 'VR27A-1100A Base Frame', documentId: D, workspaceId: W, elementId: E, description: `Onshape configuration: ${CFG}` });
    expect(createIssue.mock.calls[0][0].description).toBe(`Onshape configuration: ${CFG}`);

    const { toAssembly } = await import('../../src/server/utils/assemblySearch.js');
    const assembly = toAssembly({
      key: 'HAR-2100',
      fields: { summary: 'VR27A-1100A Base Frame', issuetype: { name: 'Assembly' }, customfield_10300: D, customfield_10301: W, customfield_10302: E, description: `Onshape configuration: ${CFG}` },
    }, { onshapeBaseUrl: 'https://cad.onshape.com' });
    expect(assembly.configuration).toBe(CFG);
    expect(assembly.onshapeUrl).toBe(`https://cad.onshape.com/documents/${D}/w/${W}/e/${E}?configuration=${encodeURIComponent(CFG)}`);
  });

  it('read the metadata of the Assembly in that configuration', async () => {
    const getElementMetadata = jest.fn().mockResolvedValue({ mimeType: 'onshape/assembly', properties: [] });
    const epic = new EpicService({ jiraClient: {}, onshapeClient: { getElementMetadata } });
    await epic._readOnshapeAssembly({ documentId: D, workspaceId: W, elementId: E, configuration: CFG }).catch(() => {});
    expect(getElementMetadata).toHaveBeenCalledWith(D, W, E, CFG);
  });
});

describe('the Assembly picture is drawn in the configuration', () => {
  it('draws a Draft in it', async () => {
    const issues = {
      'HAR-2085': { issuetype: { name: 'Build' }, customfield_10110: 'HAR-2084', customfield_10501: 1, customfield_10502: null, attachment: [] },
      'HAR-2084': { customfield_10300: D, customfield_10301: W, customfield_10302: E, description: `Onshape configuration: ${CFG}` },
    };
    const jiraClient = { getIssue: jest.fn(async (key) => ({ key, fields: issues[key] })) };
    const onshapeClient = { getAssemblyImage: jest.fn().mockResolvedValue(Buffer.from('PNG')) };
    await new Pictures({ jiraClient, onshapeClient }).buildImage('HAR-2085');
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledWith(
      { documentId: D, wvmType: 'w', wvmId: W, elementId: E, configuration: CFG }, { width: 1000, height: 700 },
    );
  });
});
