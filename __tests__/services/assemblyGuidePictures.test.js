import { jest } from '@jest/globals';
import { AssemblyGuides } from '../../src/server/services/assemblyGuides.js';

const where = { documentId: 'a'.repeat(24), wvmType: 'v', wvmId: 'b'.repeat(24), elementId: 'c'.repeat(24), configuration: null };
const part = { ...where, elementId: 'd'.repeat(24), partId: 'JHD', microversionId: null, color: [10, 20, 30] };
const sub = { ...where, elementId: 'e'.repeat(24) };
const screw = { kind: 'button', finish: 'black', d: 0.19, length: 0.75, head: 0.36, headHeight: 0.1, od: 0, id: 0.19, hexBore: false, flange: false };
const nut = { ...screw, kind: 'nut', length: 0.17, head: 0.33 };

function make({ drawn = Buffer.from('DRAWN'), kept = true } = {}) {
  const onshapeClient = {
    getPartImage: jest.fn().mockResolvedValue(Buffer.from('ONSHAPE-PART')),
    getAssemblyImage: jest.fn().mockResolvedValue(Buffer.from('ONSHAPE-ASSEMBLY')),
  };
  const partFiles = { pictureOf: jest.fn().mockResolvedValue(drawn), hasShape: jest.fn().mockReturnValue(kept) };
  const guides = new AssemblyGuides({ jiraClient: {}, onshapeClient, bomService: {}, epicService: {}, partFiles });
  guides._whereOf = jest.fn().mockResolvedValue({ assembly: {}, where });
  guides._guideAt = jest.fn().mockResolvedValue({ origins: new Map([
    ['1', part], ['2', sub],
    // Standard content (no Part Studio read) and a bought spacer known only by its name.
    ['3', { ...part, elementId: 'f'.repeat(24), hardware: screw }], ['4', { hardware: nut }],
  ]) });
  return { guides, onshapeClient, partFiles };
}

describe('Build guide pictures', () => {
  it('draws a part line from its kept Part Studio shape, in its colour, at the size asked for', async () => {
    const { guides, onshapeClient, partFiles } = make();
    expect((await guides.image('HAR-1', '1')).image.toString()).toBe('DRAWN');
    expect(partFiles.pictureOf).toHaveBeenCalledWith(part, [10, 20, 30], { width: 400, height: 300 });
    await guides.image('HAR-1', '1', { large: true });
    expect(partFiles.pictureOf).toHaveBeenLastCalledWith(part, [10, 20, 30], { width: 1200, height: 900 });
    expect(onshapeClient.getPartImage).not.toHaveBeenCalled();
  });

  it('has no picture for a part whose Part Studio has not been read, and asks OnShape for nothing', async () => {
    const { guides, onshapeClient, partFiles } = make({ kept: false });
    await expect(guides.image('HAR-1', '1')).rejects.toMatchObject({ status: 404 });
    expect(partFiles.pictureOf).not.toHaveBeenCalled();
    expect(onshapeClient.getPartImage).not.toHaveBeenCalled();
  });

  it('has no picture for a part with nothing to draw, and never asks OnShape for one', async () => {
    const { guides, onshapeClient } = make({ drawn: null });
    await expect(guides.image('HAR-1', '1')).rejects.toMatchObject({ status: 404 });
    expect(onshapeClient.getPartImage).not.toHaveBeenCalled();
  });

  it('still asks OnShape for a step\'s sub-assembly, and keeps a cut Build\'s pictures', async () => {
    const { guides, onshapeClient } = make();
    await guides.image('HAR-1', '2');
    await guides.image('HAR-1', '2');
    expect(onshapeClient.getAssemblyImage).toHaveBeenCalledTimes(1);
  });

  it('draws hardware from its name and size when no Part Studio shape is kept, asking OnShape for nothing', async () => {
    const { guides, onshapeClient, partFiles } = make({ kept: false });
    const a = await guides.image('HAR-1', '3');
    const b = await guides.image('HAR-1', '4');
    expect(a.image.subarray(1, 4).toString()).toBe('PNG');
    expect(a.live).toBe(false);
    expect(Buffer.compare(a.image, b.image)).not.toBe(0);
    expect(partFiles.pictureOf).not.toHaveBeenCalled();
    expect(onshapeClient.getAssemblyImage).not.toHaveBeenCalled();
    expect(onshapeClient.getPartImage).not.toHaveBeenCalled();
  });

  it('prefers a kept Part Studio shape over the hardware drawing', async () => {
    const { guides } = make();
    expect((await guides.image('HAR-1', '3')).image.toString()).toBe('DRAWN');
  });
});
