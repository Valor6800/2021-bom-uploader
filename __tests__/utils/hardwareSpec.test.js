import { configurationSizes, hardwareFromQuery, hardwareOf, hardwareQuery } from '../../src/server/utils/hardwareSpec.js';
import { hardwarePicture } from '../../src/server/utils/hardwarePicture.js';

// OnShape standard content's configuration for "Socket button head cap screw #10-32 x 0.75", as the BOM gives it.
const STANDARD = Buffer.from('@scp=x;BasicDiameter=0.004826+meter;HeadDiameter=0.009169400000000001+meter;'
  + 'HeadHeight=0.0025654000000000002+meter;Length=0.01905+meter;Pitch=7.9248E-4+meter').toString('base64');

describe('configurationSizes', () => {
  it('reads standard content dimensions (base64 or plain) in inches', () => {
    const sizes = configurationSizes(STANDARD);
    expect(sizes.BasicDiameter).toBeCloseTo(0.19, 4);
    expect(sizes.HeadDiameter).toBeCloseTo(0.361, 3);
    expect(sizes.Length).toBeCloseTo(0.75, 4);
    expect(configurationSizes('Length=25.4+millimeter')).toEqual({ Length: 1 });
  });

  it('is empty for a configuration with no sizes', () => {
    expect(configurationSizes('List_x=Default')).toEqual({});
    expect(configurationSizes(null)).toEqual({});
  });
});

describe('hardwareOf', () => {
  it('takes the size from standard content over the name', () => {
    const spec = hardwareOf({ name: 'Socket button head cap screw #10-32 x 0.5', configuration: STANDARD });
    expect(spec).toMatchObject({ kind: 'button', finish: 'steel' });
    expect(spec.length).toBeCloseTo(0.75, 4);
    expect(spec.head).toBeCloseTo(0.361, 3);
  });

  it.each([
    ['Socket head cap screw 1/4-20 x 1', { kind: 'socket', d: 0.25, length: 1 }],
    ['Flat head socket cap screw #10-32 x 0.5', { kind: 'flat', d: 0.19, length: 0.5 }],
    ['Socket head cap screw M5 x 0.8 x 10', { kind: 'socket' }],
    ['Hex nut #10-32', { kind: 'nut', d: 0.19 }],
    ['Nylon insert lock nut 1/4-20', { kind: 'locknut', d: 0.25 }],
    ['Plain washer #10', { kind: 'washer', d: 0.19 }],
    ['1/2" Hex Clamping Shaft Collar', { kind: 'collar', id: 0.5, hexBore: true }],
    ['1/2" Hex Bore Custom Spacer (0.75" OD,0.5" L)', { kind: 'spacer', od: 0.75, length: 0.5, id: 0.5, hexBore: true, finish: 'aluminum' }],
    ['1/2" Rounded Hex (13.75mm) ID Bearing (1.125" OD, 0.313" WD, Shielded, Flanged)', { kind: 'bearing', od: 1.125, length: 0.313, flange: true }],
    ['#10-32 x 0.25" L Shaft End Screw (Steel, Black Oxide)', { kind: 'pan', finish: 'black', length: 0.25 }],
    ['Dowel pin 1/4 x 1', { kind: 'pin', d: 0.25, length: 1 }],
    // McMaster order summaries.
    ['10-32 0.5" Button Head Screws', { kind: 'button', d: 0.19, length: 0.5 }],
    ['Zinc-Plated Grade 5 Steel Flanged Hex Head Screws 10-32 Thread Size, 5/8" Long', { kind: 'hexbolt', d: 0.19, length: 0.625 }],
    ['Black-Oxide Alloy Steel Socket Head Screw 10-32 Thread Size, 2-1/4" Long', { kind: 'socket', length: 2.25, finish: 'black' }],
    ['18-8 Stainless Steel Washer for Number 10 Screw, 0.203" ID, 0.438" OD', { kind: 'washer', id: 0.203, od: 0.438 }],
    ['Button Head Hex Drive Screw, Black-Oxide Alloy Steel, 8-32 Thread, 1-1/8" Long', { kind: 'button', d: 0.164, length: 1.125 }],
    // Toothed parts, shafts and tubes.
    ['14t Custom HTD 5mm Pulley (0.375" Wide, 1/2" Hex Bore w/ TTB Insert )', { kind: 'pulley', teeth: 14, length: 0.375, id: 0.5, hexBore: true, flange: true }],
    ['36T 20DP Aluminum Spur Gear (1/2" Hex Bore)', { kind: 'gear', teeth: 36, od: 1.9 }],
    ['16t #25 Sprocket (3/8" Hex Bore)', { kind: 'sprocket', teeth: 16, id: 0.375 }],
    ['1/2" Rounded Hex Shaft (6" L)', { kind: 'shaft', d: 0.5, length: 6, hexBore: true }],
    ['Multipurpose 6061 Aluminum Round Tube 1/8" Wall Thickness, 4" OD', { kind: 'tube', od: 4, id: 3.75 }],
  ])('reads "%s"', (name, want) => {
    const spec = hardwareOf({ name });
    expect(spec).toMatchObject(want);
  });

  it('reads a metric length in millimetres', () => {
    expect(hardwareOf({ name: 'Socket head cap screw M5 x 0.8 x 10' }).length).toBeCloseTo(10 / 25.4, 4);
  });

  it('reads a pulley without its pitch as HTD 5 mm, and its tip from the teeth', () => {
    expect(hardwareOf({ name: '18t x 9mm Wide Aluminum Pulley (HTD 5mm, 8mm SplineXS Bore)' }).od).toBeCloseTo((18 * 5) / 25.4 / Math.PI, 4);
  });

  it.each(['Pulley with no teeth count', 'Kraken X60 Brushless Motor', 'Nut Strip (1/2" Square, #10-32 Tapped)', 'Hex nut', ''])(
    'draws nothing for "%s"',
    (name) => { expect(hardwareOf({ name })).toBeNull(); },
  );
});

describe('hardwareQuery / hardwareFromQuery', () => {
  it('round-trips a spec through a picture address', () => {
    const spec = hardwareOf({ name: '1/2" Hex Bore Custom Spacer (0.75" OD,0.5" L)' });
    const back = hardwareFromQuery(Object.fromEntries(new URLSearchParams(hardwareQuery(spec))));
    expect(back).toMatchObject({ kind: 'spacer', od: 0.75, length: 0.5, hexBore: true, finish: 'aluminum' });
    const pulley = hardwareOf({ name: '24t HTD 5mm Pulley (0.375" Wide, 1/2" Hex Bore)' });
    expect(hardwareFromQuery(Object.fromEntries(new URLSearchParams(hardwareQuery(pulley))))).toMatchObject({ kind: 'pulley', teeth: 24 });
  });

  it('refuses a toothed part without a sensible tooth count', () => {
    const q = hardwareQuery(hardwareOf({ name: '24t HTD 5mm Pulley (0.375" Wide, 1/2" Hex Bore)' }));
    for (const teeth of [undefined, '3', '5000', '2.5', 'x']) {
      expect(hardwareFromQuery({ ...q, teeth })).toBeNull();
    }
  });
});

describe('hardwarePicture', () => {
  it.each([
    'Socket button head cap screw #10-32 x 0.75', 'Socket head cap screw 1/4-20 x 1', 'Flat head socket cap screw #10-32 x 0.5',
    'Hex head cap screw 3/8-16 x 1.5', 'Set screw #10-32 x 0.25', 'Shoulder screw 1/4 x 1 (#10-24)', 'Hex nut #10-32', 'Nylon insert lock nut 1/4-20',
    'Plain washer #10', '14t HTD 5mm Pulley (0.375" Wide, 1/2" Hex Bore)', '36T 20DP Spur Gear', '16t #25 Sprocket', '1/2" Hex Shaft (6" L)',
    'Round Tube 1/8" Wall Thickness, 2" OD', 'Hex standoff #10-32 x 1 (0.375" OD)', '1/2" Hex Bore Spacer (0.75" OD,0.5" L)',
    '1/2" Rounded Hex ID Bearing (1.125" OD, 0.313" WD, Flanged)', 'Dowel pin 1/4 x 1', 'Pop rivet 3/16 x 0.25',
  ])('draws "%s" as a PNG', (name) => {
    const spec = hardwareOf({ name });
    expect(spec).not.toBeNull();
    const png = hardwarePicture(spec, { width: 120, height: 90 });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(300);
  });
});
