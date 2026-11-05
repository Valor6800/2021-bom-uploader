import { isPartFile, missingFiles } from '../../src/server/utils/partFileCheck.js';
import { missingText } from '../../src/client/src/lib/missingFiles.js';

const pn = 'VR26P-2204C';

describe('missingFiles', () => {
  it('asks every Part for its picture and drawings', () => {
    expect(missingFiles({ fullPartNumber: pn, machinery: 'CNC Mill', files: [] })).toEqual(['picture', 'drawing']);
    expect(missingFiles({ fullPartNumber: pn, machinery: 'CNC Mill', files: [`${pn}.png`, `${pn}_drawings.pdf`] })).toEqual([]);
  });

  it('asks a routed plate for a DXF and a 3D print for its STEP', () => {
    const files = [`${pn}.png`, `${pn}_drawings.pdf`, `${pn}_drawing.png`];
    expect(missingFiles({ fullPartNumber: pn, machinery: 'CNC Router', files })).toEqual(['DXF']);
    expect(missingFiles({ fullPartNumber: pn, machinery: 'CNC Router', files: [...files, `${pn}_POCKET_0.125.dxf`] })).toEqual([]);
    expect(missingFiles({ fullPartNumber: pn, machinery: '3D Printer', files })).toEqual(['STEP']);
  });

  it('counts only this Part\'s own files', () => {
    expect(missingFiles({ fullPartNumber: pn, machinery: 'None', files: [`${pn}X.png`, 'VR26P-2204B_drawings.pdf'] })).toEqual(['picture', 'drawing']);
  });

  it('is null when the files are not known', () => {
    expect(missingFiles({ fullPartNumber: pn, machinery: 'None' })).toBeNull();
    expect(missingFiles({ machinery: 'None', files: [] })).toBeNull();
  });
});

describe('isPartFile', () => {
  it.each([[`${pn}.png`, true], [`${pn}_drawing_REAR.png`, true], [`${pn}.step`, true], [`${pn}X.png`, false], [`${pn}.txt`, false], ['x.png', false]])(
    '%s → %s',
    (name, want) => { expect(isPartFile(name, pn)).toBe(want); },
  );
});

describe('missingText', () => {
  it('names each Part and what it lacks, a few at a time', () => {
    expect(missingText([{ key: 'HAR-1', fullPartNumber: pn, filesMissing: ['DXF'] }])).toBe(`1 Part is missing files: ${pn} (DXF).`);
    const many = Array.from({ length: 6 }, (_, i) => ({ key: `HAR-${i}`, filesMissing: ['picture'] }));
    expect(missingText(many)).toBe('6 Parts are missing files: HAR-0 (picture), HAR-1 (picture), HAR-2 (picture), HAR-3 (picture), 2 more.');
  });
});
