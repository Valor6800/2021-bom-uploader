import { buildGuide, LineKind } from '../../src/server/utils/assemblyGuide.js';

const DOC = 'a'.repeat(24);
const HEADERS = [
  { name: 'Item', propertyName: 'item' },
  { name: 'Name', propertyName: 'name' },
  { name: 'Part number', propertyName: 'partNumber' },
  { name: 'Quantity', propertyName: 'quantity' },
  { name: 'Description', propertyName: 'description' },
  { name: 'Material', propertyName: 'material' },
  { name: 'Vendor', propertyName: 'vendor' },
];

/** A BOM row. `asm`: an assembly tab (no partId). */
function row(item, name, quantity, {
  partNumber = '', doc = DOC, element = `el-${item}`, asm = false, std = false, exclude = false, configuration = 'default', material = '', vendor = '',
} = {}) {
  return {
    item,
    name,
    quantity,
    partNumber,
    description: '',
    vendor,
    material: material ? { displayName: material } : 'N/A',
    excludeFromBom: exclude,
    itemSource: {
      documentId: doc, elementId: element, wvmType: 'w', wvmId: 'w1', configuration,
      ...(asm ? { partId: '' } : { partId: `P${item}` }),
      isStandardContent: std,
    },
  };
}

/** Shaped like the live "Bumper" assembly. */
const bumper = () => ({
  headers: HEADERS,
  items: [
    row('1', 'FrontBumperWood', 2, { partNumber: '1201', material: 'Birch' }),
    row('2', 'Bumper Mount', 4, { asm: true, element: 'mount' }),
    row('2.1', 'Billet Bumper Mount', 1, { partNumber: '1207' }),
    row('2.2', 'WCP-1109-002 Rev1', 1, { doc: 'b'.repeat(24) }),
    row('3', 'Bumper Corner Gusset', 4, { asm: true, element: 'gusset' }),
    row('3.1', 'InnerBracket', 1, { partNumber: '1203' }),
    row('3.2', 'Hex machine screw nut #10-32', 6, { doc: 'c'.repeat(24), std: true, material: 'Stainless Steel' }),
    row('3.3', 'Socket button head cap screw #10-32 x 1.25', 6, { doc: 'd'.repeat(24), std: true }),
    row('4', 'Hidden thing', 9, { exclude: true }),
  ],
});

describe('buildGuide', () => {
  it('makes a step per sub-assembly, deepest first, with the Assembly last', () => {
    const { steps } = buildGuide(bumper(), { documentId: DOC, name: 'Bumper' });
    expect(steps.map((s) => [s.number, s.name, s.count])).toEqual([
      [1, 'Bumper Mount', 4],
      [2, 'Bumper Corner Gusset', 4],
      [3, 'Bumper', 1],
    ]);
    expect(steps[2].id).toBe('root');
  });

  it('kits the hardware and vendor parts per step, for every unit it builds', () => {
    const { steps, kit } = buildGuide(bumper(), { documentId: DOC, name: 'Bumper' });
    const gusset = steps[1];
    const nuts = gusset.lines.find((l) => l.name.startsWith('Hex'));
    expect(nuts).toMatchObject({ kind: LineKind.HARDWARE, perUnit: 6, total: 24, material: 'Stainless Steel' });
    const bolt = steps[0].lines.find((l) => l.kind === LineKind.VENDOR);
    expect(bolt).toMatchObject({ sku: 'WCP-1109', vendor: 'WCP', perUnit: 1, total: 4 });
    expect(kit.map((k) => [k.kind, k.total, k.steps])).toEqual([
      ['hardware', 24, [2]],
      ['hardware', 24, [2]],
      ['vendor', 4, [1]],
    ]);
  });

  it('lists made Parts by number and links earlier steps; leaves out excluded rows', () => {
    const { steps } = buildGuide(bumper(), { documentId: DOC, name: 'Bumper' });
    const root = steps[2];
    expect(root.lines.map((l) => [l.kind, l.name, l.number ?? null, l.perUnit])).toEqual([
      ['made', 'FrontBumperWood', '1201', 2],
      ['step', 'Bumper Mount', null, 4],
      ['step', 'Bumper Corner Gusset', null, 4],
    ]);
    expect(root.lines[1].stepId).toBe('2');
    expect(root.lines[1].imageId).toBe('2');
  });

  it('does not open a numbered sub-assembly: it is an Assembly of its own', () => {
    const table = {
      headers: HEADERS,
      items: [
        row('1', '[1200] Bumper', 1, { asm: true, partNumber: '1200', element: 'bumper' }),
        row('1.1', 'FrontBumperWood', 2, { partNumber: '1201' }),
        row('2', 'Robot Battery', 1, { doc: 'e'.repeat(24), partNumber: 'WCP-1492' }),
      ],
    };
    const { steps } = buildGuide(table, { documentId: DOC, name: 'Chassis' });
    expect(steps).toHaveLength(1);
    expect(steps[0].lines.map((l) => [l.kind, l.name, l.number ?? l.sku])).toEqual([
      ['assembly', 'Bumper', '1200'],
      ['vendor', 'Robot Battery', 'WCP-1492'],
    ]);
  });

  it('builds one sub-assembly used in two places as one step, counting every use', () => {
    const table = {
      headers: HEADERS,
      items: [
        row('1', 'Side', 2, { asm: true, element: 'side' }),
        row('1.1', 'Gusset', 3, { asm: true, element: 'gusset' }),
        row('1.1.1', 'Screw', 2, { doc: 'c'.repeat(24), std: true }),
        row('2', 'Gusset', 1, { asm: true, element: 'gusset' }),
        row('2.1', 'Screw', 2, { doc: 'c'.repeat(24), std: true }),
      ],
    };
    const { steps, kit } = buildGuide(table, { documentId: DOC, name: 'Frame' });
    expect(steps.map((s) => [s.name, s.count])).toEqual([['Gusset', 7], ['Side', 2], ['Frame', 1]]);
    expect(steps[0].lines[0].total).toBe(14);
    expect(kit[0].total).toBe(14);
  });

  it('tells two configurations of one sub-assembly apart', () => {
    const table = {
      headers: HEADERS,
      items: [
        row('1', 'Swerve', 1, { asm: true, element: 'swerve', configuration: 'List_a=Simple' }),
        row('1.1', 'Plate', 1, { doc: 'b'.repeat(24), partNumber: 'WCP-1706' }),
        row('2', 'Swerve', 3, { asm: true, element: 'swerve', configuration: 'List_a=Full' }),
        row('2.1', 'Plate', 1, { doc: 'b'.repeat(24), partNumber: 'WCP-1706' }),
      ],
    };
    const { steps, kit } = buildGuide(table, { documentId: DOC, name: 'Base' });
    expect(steps.map((s) => s.name)).toEqual(['Swerve (variant 1)', 'Swerve (variant 2)', 'Base']);
    expect(steps[2].lines.map((l) => l.name)).toEqual(['Swerve (variant 1)', 'Swerve (variant 2)']);
    expect(kit).toEqual([expect.objectContaining({ sku: 'WCP-1706', total: 4, steps: [1, 2] })]);
  });

  it('hands out picture ids only for rows it can draw', () => {
    const table = bumper();
    delete table.items[0].itemSource.wvmId;
    const { steps, origins } = buildGuide(table, { documentId: DOC, name: 'Bumper' });
    expect(steps[2].lines[0].imageId).toBeNull();
    expect(origins.get('3.2')).toMatchObject({ documentId: 'c'.repeat(24), partId: 'P3.2', wvmType: 'w' });
    expect(origins.get('2')).toMatchObject({ elementId: 'mount' });
    expect(origins.get('2').partId).toBeUndefined();
  });

  it('copes with an empty BOM', () => {
    const { steps, kit } = buildGuide({ headers: HEADERS, items: [] }, { documentId: DOC, name: 'Empty' });
    expect(steps).toEqual([expect.objectContaining({ id: 'root', lines: [] })]);
    expect(kit).toEqual([]);
  });
});

describe('buildGuide numbered Parts', () => {
  it('lists one Part number once, summing its rows', () => {
    const table = {
      headers: HEADERS,
      items: [
        row('1', '1x1Spacer', 4, { partNumber: '1103', element: 'ps' }),
        row('2', '1x1Spacer', 4, { partNumber: '1103', element: 'ps' }),
      ],
    };
    table.items[1].itemSource.partId = 'OTHER';
    const { steps } = buildGuide(table, { documentId: DOC, name: 'Base' });
    expect(steps[0].lines).toEqual([expect.objectContaining({ kind: 'made', number: '1103', perUnit: 8, total: 8 })]);
  });
});
