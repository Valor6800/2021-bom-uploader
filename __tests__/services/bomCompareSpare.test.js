import { BOMService } from '../../src/server/services/bomService.js';

describe('BOMService.compareBOMWithJira with a spare', () => {
  const story = (key, quantity) => ({
    key, fullPartNumber: 'VF27P-0001A', quantity, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None',
  });
  const item = { fullPartNumber: 'VF27P-0001A', quantity: 3, material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None' };

  it.each([
    ['spare listed last', [story('HAR-2031', 1), story('HAR-2040', 1)]],
    ['spare listed first', [story('HAR-2040', 1), story('HAR-2031', 1)]],
  ])('matches CAD to the original (%s)', (_, stories) => {
    const { matched, unmatched } = new BOMService({}).compareBOMWithJira([item], stories);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0].story.key).toBe('HAR-2031');
    expect(matched[0].changes).toMatchObject({ count: 1, quantity: 3 });
  });
});
