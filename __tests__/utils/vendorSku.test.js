import { SKU_PATTERN, productPageOf, skuOf } from '../../src/server/utils/vendorSku.js';

describe('skuOf', () => {
  it.each([
    [{ partNumber: 'WCP-1706', name: 'WCP Swerve X2 (Bottom Support Plate) (WCP-1706)' }, 'WCP-1706', 'WCP'],
    [{ partNumber: '', name: 'WCP-1109-001 Rev1' }, 'WCP-1109', 'WCP'],
    [{ partNumber: 'WCP-0940-12' }, 'WCP-0940', 'WCP'],
    [{ partNumber: 'N/A', name: 'thing', description: 'rev-21-1650 NEO' }, 'REV-21-1650', 'Rev'],
    [{ partNumber: 'am-0005' }, 'AM-0005', 'Andymark'],
    [{ partNumber: '91251a540' }, '91251A540', 'McMaster-Carr'],
  ])('reads %j', (row, sku, vendor) => {
    expect(skuOf(row)).toEqual({ sku, vendor });
  });

  it.each([
    [{ partNumber: 'N/A', name: 'WCP Swerve X2' }],
    [{ partNumber: '1101', name: 'FrontChassisTube' }],
    [{ partNumber: 'ES17-12', name: 'Robot Battery' }],
    [{}],
  ])('finds none in %j', (row) => {
    expect(skuOf(row)).toBeNull();
  });
});

describe('productPageOf', () => {
  it('builds the vendor page from the SKU', () => {
    expect(productPageOf({ sku: 'WCP-1706', vendor: 'WCP' })).toBe('https://wcproducts.com/products/wcp-1706');
    expect(productPageOf({ sku: '91251A540', vendor: 'McMaster-Carr' })).toBe('https://www.mcmaster.com/91251A540/');
    expect(productPageOf({ sku: 'X-1', vendor: 'Nobody' })).toBeNull();
  });

  it('refuses anything that is not a plain SKU', () => {
    expect(SKU_PATTERN.test('WCP-1706')).toBe(true);
    for (const bad of ['../etc', 'WCP 1706', 'a"b', '', 'wcp-1706']) expect(SKU_PATTERN.test(bad)).toBe(false);
    expect(productPageOf({ sku: '../x', vendor: 'WCP' })).toBeNull();
  });
});
