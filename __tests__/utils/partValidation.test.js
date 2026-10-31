import { validateRowFields } from '../../src/client/src/lib/partValidation.js';
import { validatePartPayload } from '../../src/server/utils/validators.js';
import {
  MATERIALS as SERVER_MATERIALS, MACHINERY as SERVER_MACHINERY,
  POWDERCOAT as SERVER_POWDERCOAT, THICKNESS as SERVER_THICKNESS, PRIORITIES as SERVER_PRIORITIES,
} from '../../src/server/utils/bomConstants.js';
import { MATERIALS, MACHINERY, POWDERCOAT, THICKNESS, PRIORITIES } from '../../src/client/src/api/client.js';

const valid = { material: 'PLA', machinery: '3D Printer', powdercoat: 'None', thickness: 'None', quantity: 1 };

const cases = [
  ...SERVER_MATERIALS.map((material) => ({ ...valid, material })),
  ...SERVER_MACHINERY.map((machinery) => ({ ...valid, machinery })),
  ...SERVER_POWDERCOAT.map((powdercoat) => ({ ...valid, powdercoat })),
  ...SERVER_THICKNESS.map((thickness) => ({ ...valid, thickness })),
  { ...valid, material: 'Steel' },
  { ...valid, material: '' },
  { ...valid, machinery: 'Laser' },
  { ...valid, powdercoat: 'Red' },
  { ...valid, thickness: '0.5' },
  { ...valid, quantity: 0 },
  { ...valid, quantity: 1.5 },
  { ...valid, quantity: '2' },
  { ...valid, quantity: 12 },
  ...SERVER_PRIORITIES.map((priority) => ({ ...valid, priority })),
  { ...valid, priority: undefined },
  { ...valid, priority: null },
  { ...valid, priority: 'Urgent' },
  { ...valid, priority: 'medium' },
  { ...valid, priority: '' },
];

describe('validateRowFields agrees with the server', () => {
  it.each(cases.map((c) => [JSON.stringify(c), c]))('%s', (_, c) => {
    const client = validateRowFields(c) === null;
    const server = validatePartPayload(c).valid;
    expect(client).toBe(server);
  });

  it('mirrors the server constants exactly', () => {
    expect(MATERIALS).toEqual(SERVER_MATERIALS);
    expect(MACHINERY).toEqual(SERVER_MACHINERY);
    expect(POWDERCOAT).toEqual(SERVER_POWDERCOAT);
    expect(THICKNESS).toEqual(SERVER_THICKNESS);
    expect(PRIORITIES).toEqual(SERVER_PRIORITIES);
  });
});

describe('validateRowFields messages', () => {
  it('names an unlisted material', () => {
    expect(validateRowFields({ ...valid, material: 'Steel' }))
      .toEqual({ field: 'material', error: '"Steel" isn\'t on the material list. Change the material in OnShape.' });
  });
  it('names an unlisted priority', () => {
    expect(validateRowFields({ ...valid, priority: 'Urgent' }))
      .toEqual({ field: 'priority', error: "\"Urgent\" isn't on the priority list. Pick one." });
  });
  it('reports the first failing field in server order', () => {
    expect(validateRowFields({ ...valid, machinery: 'Laser', quantity: 0 }).field).toBe('machinery');
  });
  it('checks the Revision against the number letter', () => {
    expect(validateRowFields({ ...valid, summary: 'VF27P-0004A Spacer', revision: 'B' }).field).toBe('revision');
    expect(validateRowFields({ ...valid, summary: 'VF27P-0004A Spacer', revision: 'A' })).toBeNull();
    expect(validateRowFields({ ...valid, summary: 'VF27P-0004A Spacer', revision: 'AA' }).field).toBe('revision');
  });
});
