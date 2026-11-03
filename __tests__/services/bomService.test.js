import { jest } from '@jest/globals';
import { BOMService } from '../../src/server/services/bomService.js';

// Headers as the live OnShape BOM (legacy `bomTable` format) reports them.
const HEADERS = [
  { propertyName: 'item', name: 'Item', propertyId: '5ace8269c046ad612c65a0ba', visible: true },
  { propertyName: 'quantity', name: 'Quantity', propertyId: '5ace84d3c046ad611c65a0dd', visible: true },
  { propertyName: 'partNumber', name: 'Part number', propertyId: '57f3fb8efa3416c06701d60f', visible: true },
  { propertyName: 'name', name: 'Name', propertyId: '57f3fb8efa3416c06701d60d', visible: true },
  { propertyName: 'material', name: 'Material', propertyId: '57f3fb8efa3416c06701d615', visible: true },
  { propertyName: 'revision', name: 'Revision', propertyId: '57f3fb8efa3416c06701d610', visible: true },
  { propertyName: 'project', name: 'Project', propertyId: '57f3fb8efa3416c06701d613', visible: false },
];

const VF27 = { seasonType: 'F', year: '27' };

function bom(items, headers = HEADERS) {
  return { bomTable: { formatVersion: '1.0', headers, items } };
}

function row(overrides = {}) {
  return {
    item: '1',
    quantity: 1,
    partNumber: '0001',
    revision: 'A',
    project: '',
    name: 'Test Part',
    material: { id: 'PLA', displayName: 'PLA' },
    ...overrides,
  };
}

describe('BOMService._parseBOM — property-based identification', () => {
  const service = new BOMService({ onshapeClient: {} });

  it('builds the part number from Part number + Revision and the Assembly season', () => {
    const { parts, unidentified } = service._parseBOM(bom([row()]), 'HAR-2030', VF27);

    expect(unidentified).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      fullPartNumber: 'VF27P-0001A',
      seasonType: 'F',
      year: '27',
      partNumber: '0001',
      version: 'A',
      name: 'Test Part',
      quantity: 1,
      epic: 'HAR-2030',
    });
  });

  it('prefers the row\'s own Project property over the Assembly season', () => {
    const { parts } = service._parseBOM(bom([row({ project: 'VR26' })]), 'HAR-1', VF27);
    expect(parts[0].fullPartNumber).toBe('VR26P-0001A');
  });

  it('matches columns by propertyId first, then header name', () => {
    // Renamed propertyNames: values are found through the propertyId match.
    const byId = HEADERS.map((h) => (
      h.propertyId === '57f3fb8efa3416c06701d610' ? { ...h, propertyName: 'rev', name: 'Rev' } : h
    ));
    const fromId = service._parseBOM(
      bom([row({ revision: undefined, rev: 'B' })], byId), 'HAR-1', VF27,
    );
    expect(fromId.parts[0].fullPartNumber).toBe('VF27P-0001B');

    // Unknown propertyId: values are found through the "Revision" header name.
    const byName = HEADERS.map((h) => (
      h.name === 'Revision' ? { ...h, propertyId: 'other', propertyName: 'customRevision' } : h
    ));
    const fromName = service._parseBOM(
      bom([row({ revision: undefined, customRevision: 'C' })], byName), 'HAR-1', VF27,
    );
    expect(fromName.parts[0].fullPartNumber).toBe('VF27P-0001C');
  });

  it('aggregates quantities of rows with the same composed number', () => {
    const { parts } = service._parseBOM(
      bom([row({ item: '1', quantity: 2 }), row({ item: '2', quantity: 3 })]), 'HAR-1', VF27,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].quantity).toBe(5);
  });

  it('skips nested sub-assembly rows without reporting them', () => {
    const { parts, unidentified } = service._parseBOM(
      bom([row(), row({ item: '1.1', partNumber: '', name: 'Nested' })]), 'HAR-1', VF27,
    );
    expect(parts).toHaveLength(1);
    expect(unidentified).toEqual([]);
  });
});

describe('BOMService._parseBOM — legacy name-based BOMs', () => {
  const service = new BOMService({ onshapeClient: {} });

  it('still accepts a full part number typed into the Part number cell', () => {
    const { parts, unidentified } = service._parseBOM(
      bom([row({ partNumber: 'VR26P-1234A', revision: '', name: 'Side Plate' })]), 'VAL-1',
    );
    expect(unidentified).toEqual([]);
    expect(parts[0]).toMatchObject({ fullPartNumber: 'VR26P-1234A', name: 'Side Plate' });
  });

  it('falls back to a Name that already holds the full part number', () => {
    const { parts } = service._parseBOM(
      bom([row({ partNumber: '', revision: '', name: 'VR26P-0042B Bracket' })]), 'VAL-1',
    );
    expect(parts[0]).toMatchObject({ fullPartNumber: 'VR26P-0042B', name: 'Bracket' });
  });

  it('still requires the standard BOM columns', () => {
    expect(() => service._parseBOM(bom([], HEADERS.filter((h) => h.propertyName !== 'name')), 'VAL-1'))
      .toThrow(/missing required columns: name/);
  });
});

describe('BOMService._parseBOM — unidentifiable rows are reported', () => {
  const service = new BOMService({ onshapeClient: {} });

  it('reports a bare number when neither the part nor the Assembly gives a Project', () => {
    const { parts, unidentified } = service._parseBOM(bom([row()]), 'HAR-1', null);
    expect(parts).toEqual([]);
    expect(unidentified).toEqual([
      expect.objectContaining({
        name: 'Test Part',
        partNumber: '0001',
        problems: [expect.stringMatching(/missing Project/)],
      }),
    ]);
  });

  it('names each missing or malformed property', () => {
    const { parts, unidentified } = service._parseBOM(bom([
      row({ item: '1', name: 'No Number', partNumber: '' }),
      row({ item: '3', name: 'Bad Project', project: 'FOO' }),
      row({ item: '4', name: 'Bad Number', partNumber: '12' }),
      row({ item: '5', name: 'Good' }),
    ]), 'HAR-1', VF27);

    expect(parts.map((p) => p.fullPartNumber)).toEqual(['VF27P-0001A']);
    expect(unidentified.map((u) => [u.name, u.problems])).toEqual([
      ['No Number', [expect.stringMatching(/missing Part number/)]],
      ['Bad Project', [expect.stringMatching(/invalid Project "FOO"/)]],
      ['Bad Number', [expect.stringMatching(/invalid Part number "12"/)]],
    ]);
  });
});

describe('BOMService.getBOM / getBOMReport', () => {
  it('getBOM keeps returning just the parts array', async () => {
    const onshapeClient = { getAssemblyBOM: jest.fn().mockResolvedValue(bom([row()])) };
    const service = new BOMService({ onshapeClient });
    const parts = await service.getBOM('HAR-1', 'd-getbom', 'w', 'e', VF27);
    expect(Array.isArray(parts)).toBe(true);
    expect(parts[0].fullPartNumber).toBe('VF27P-0001A');
  });

  it('getBOMReport returns parts and unidentified rows', async () => {
    const onshapeClient = { getAssemblyBOM: jest.fn().mockResolvedValue(bom([row(), row({ item: '2', name: 'X', project: 'FOO' })])) };
    const service = new BOMService({ onshapeClient });
    const report = await service.getBOMReport('HAR-1', 'd-report', 'w', 'e', VF27);
    expect(report.parts).toHaveLength(1);
    expect(report.unidentified).toHaveLength(1);
    expect(onshapeClient.getAssemblyBOM).toHaveBeenCalledWith('d-report', 'w', 'e', { multiLevel: true });
  });
});
describe('BOMService._parseBOM — rows excluded from BOMs (B4)', () => {
  const service = new BOMService({ onshapeClient: {} });
  it('skips an excluded row with no Part number without reporting it', () => {
    const { parts, unidentified } = service._parseBOM(
      bom([row(), row({ item: '2', partNumber: '', name: 'Fastener', excludeFromBom: true })]), 'HAR-1', VF27,
    );
    expect(parts.map((p) => p.fullPartNumber)).toEqual(['VF27P-0001A']);
    expect(unidentified).toEqual([]);
  });
  it('skips an excluded row that has a valid Part number', () => {
    const { parts, unidentified } = service._parseBOM(
      bom([row({ excludeFromBom: true })]), 'HAR-1', VF27,
    );
    expect(parts).toEqual([]);
    expect(unidentified).toEqual([]);
  });
  it('parses a row with excludeFromBom false normally', () => {
    const { parts } = service._parseBOM(bom([row({ excludeFromBom: false })]), 'HAR-1', VF27);
    expect(parts.map((p) => p.fullPartNumber)).toEqual(['VF27P-0001A']);
  });
});

describe('BOMService.getBOMReport fresh option (INC-4)', () => {
  it('reads OnShape again with fresh: true and a warm cache', async () => {
    const onshapeClient = { getAssemblyBOM: jest.fn().mockResolvedValue(bom([row()])) };
    const service = new BOMService({ onshapeClient });
    await service.getBOMReport('HAR-1', 'd-fresh', 'w', 'e', VF27);
    await service.getBOMReport('HAR-1', 'd-fresh', 'w', 'e', VF27, { fresh: true });
    expect(onshapeClient.getAssemblyBOM).toHaveBeenCalledTimes(2);
  });

  it('uses the cache without it', async () => {
    const onshapeClient = { getAssemblyBOM: jest.fn().mockResolvedValue(bom([row()])) };
    const service = new BOMService({ onshapeClient });
    await service.getBOMReport('HAR-1', 'd-cached', 'w', 'e', VF27);
    await service.getBOMReport('HAR-1', 'd-cached', 'w', 'e', VF27);
    expect(onshapeClient.getAssemblyBOM).toHaveBeenCalledTimes(1);
  });
});

describe('BOMService._parseBOM — sub-assemblies', () => {
  const service = new BOMService({ onshapeClient: {} });
  const DOC = 'a'.repeat(24);
  const WS = 'b'.repeat(24);
  const EL = 'c'.repeat(24);
  const source = (over = {}) => ({
    documentId: DOC, wvmType: 'w', wvmId: WS, elementId: EL, configuration: 'default', ...over,
  });
  const partRow = (over = {}) => row({ itemSource: source({ partId: 'JHD' }), ...over });
  const subRow = (over = {}) => row({
    item: '2', partNumber: '1100', name: 'Intake', itemSource: source({ elementId: 'd'.repeat(24) }), ...over,
  });

  it('lists a row with no partId as a sub-assembly, not a Part', () => {
    const { parts, unidentified, subAssemblies } = service._parseBOM(bom([partRow(), subRow()]), 'HAR-1', VF27);
    expect(parts.map((p) => p.fullPartNumber)).toEqual(['VF27P-0001A']);
    expect(unidentified).toEqual([]);
    expect(subAssemblies).toEqual([{
      item: '2', name: 'Intake', partNumber: '1100', revision: 'A', project: '',
      documentId: DOC, elementId: 'd'.repeat(24), wvmType: 'w', wvmId: WS, configuration: null,
    }]);
  });

  it('lists a row that has nested rows as a sub-assembly even when it carries a partId', () => {
    const { parts, subAssemblies } = service._parseBOM(bom([
      partRow({ item: '2', partNumber: '1100', name: 'Intake' }),
      partRow({ item: '2.1', partNumber: '', name: 'Plate' }),
    ]), 'HAR-1', VF27);
    expect(parts).toEqual([]);
    expect(subAssemblies.map((s) => s.name)).toEqual(['Intake']);
  });

  it('keeps nested rows out of both lists', () => {
    const { parts, unidentified, subAssemblies } = service._parseBOM(bom([
      subRow(), row({ item: '2.1', partNumber: '', name: 'Plate', itemSource: source({ partId: 'X' }) }),
    ]), 'HAR-1', VF27);
    expect(parts).toEqual([]);
    expect(unidentified).toEqual([]);
    expect(subAssemblies).toHaveLength(1);
  });

  it('treats a row with a partId and no children as a Part', () => {
    const { parts, subAssemblies } = service._parseBOM(bom([partRow()]), 'HAR-1', VF27);
    expect(parts).toHaveLength(1);
    expect(subAssemblies).toEqual([]);
  });

  it('treats a row with no itemSource as a Part', () => {
    const { parts, subAssemblies } = service._parseBOM(bom([row()]), 'HAR-1', VF27);
    expect(parts).toHaveLength(1);
    expect(subAssemblies).toEqual([]);
  });

  it('lists a sub-assembly once however many times it is used', () => {
    const { subAssemblies } = service._parseBOM(bom([subRow({ item: '2' }), subRow({ item: '3' })]), 'HAR-1', VF27);
    expect(subAssemblies).toHaveLength(1);
  });

  it('skips an excluded sub-assembly row', () => {
    const { subAssemblies } = service._parseBOM(bom([subRow({ excludeFromBom: true })]), 'HAR-1', VF27);
    expect(subAssemblies).toEqual([]);
  });
});

describe('BOMService._parseBOM — [bracketed] names', () => {
  const service = new BOMService({ onshapeClient: {} });

  it('drops the brackets from a Part name, in the name and the summary', () => {
    const { parts } = service._parseBOM(bom([row({ name: '[0001] Side Plate' })]), 'HAR-1', VF27);
    expect(parts[0]).toMatchObject({ name: 'Side Plate', summary: 'VF27P-0001A Side Plate', fullPartNumber: 'VF27P-0001A' });
  });

  it('drops the brackets from a sub-assembly name', () => {
    const { subAssemblies } = service._parseBOM(bom([row({
      item: '3', partNumber: '', name: '[1300] Electrical',
      itemSource: { documentId: 'a'.repeat(24), elementId: 'b'.repeat(24), wvmType: 'w', wvmId: 'c'.repeat(24), partId: '' },
    })]), 'HAR-1', VF27);
    expect(subAssemblies[0].name).toBe('Electrical');
  });
});

