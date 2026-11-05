import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { OrderDraft } from '../../src/server/services/orderDraft.js';

describe('OrderDraft', () => {
  let dir;
  let file;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'order-draft-'));
    file = path.join(dir, 'draft.json');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts empty when nothing has been saved', async () => {
    expect(await new OrderDraft({ file }).read()).toEqual({});
  });

  it('keeps saved rows across a server restart', async () => {
    await new OrderDraft({ file }).update([
      { key: 'PARTS-1', selected: true, classification: 'Game', wishId: 3 },
    ]);

    expect(await new OrderDraft({ file }).read()).toEqual({
      'PARTS-1': { selected: true, classification: 'Game', wishId: 3 },
    });
  });

  it('changes only the fields named, so mentors do not overwrite each other', async () => {
    const draft = new OrderDraft({ file });

    await Promise.all([
      draft.update([{ key: 'PARTS-1', selected: true }]),
      draft.update([{ key: 'PARTS-1', classification: 'Game' }]),
      draft.update([{ key: 'PARTS-1', wishId: 3 }]),
      draft.update([{ key: 'PARTS-2', selected: true }]),
    ]);

    expect(await draft.read()).toEqual({
      'PARTS-1': { selected: true, classification: 'Game', wishId: 3 },
      'PARTS-2': { selected: true },
    });
  });

  it('keeps Wish ID 0, which is a real bucket, and null, which clears the bucket', async () => {
    const draft = new OrderDraft({ file });

    await draft.update([{ key: 'PARTS-1', wishId: 0 }, { key: 'PARTS-2', wishId: 3 }]);
    await draft.update([{ key: 'PARTS-2', wishId: null }]);

    expect(await new OrderDraft({ file }).read()).toEqual({
      'PARTS-1': { wishId: 0 },
      'PARTS-2': { wishId: null },
    });
  });

  it.each([
    ['no rows', undefined],
    ['an empty list', []],
    ['too many rows', Array.from({ length: 1001 }, (_, i) => ({ key: `PARTS-${i}`, selected: true }))],
    ['a missing key', [{ selected: true }]],
    ['a key that could reach the prototype', [{ key: '__proto__', selected: true }]],
    ['a selected that is not a boolean', [{ key: 'PARTS-1', selected: 'yes' }]],
    ['an empty classification', [{ key: 'PARTS-1', classification: '' }]],
    ['a classification that is not text', [{ key: 'PARTS-1', classification: 7 }]],
    ['a wishId that is text', [{ key: 'PARTS-1', wishId: '3' }]],
  ])('refuses %s with a 400 and saves nothing', async (_name, rows) => {
    const draft = new OrderDraft({ file });

    await expect(draft.update(rows)).rejects.toMatchObject({ status: 400 });
    expect(await draft.read()).toEqual({});
  });

  it('saves nothing if any row in the batch is invalid', async () => {
    const draft = new OrderDraft({ file });

    await expect(draft.update([
      { key: 'PARTS-1', selected: true },
      { key: 'nope', selected: true },
    ])).rejects.toMatchObject({ status: 400 });

    expect(await draft.read()).toEqual({});
  });

  it('ignores fields it does not know', async () => {
    const draft = new OrderDraft({ file });

    await draft.update([{ key: 'PARTS-1', selected: true, price: 0 }]);

    expect(await draft.read()).toEqual({ 'PARTS-1': { selected: true } });
  });

  it('retain forgets tickets that have left the queue, on disk too', async () => {
    const draft = new OrderDraft({ file });
    await draft.update([{ key: 'PARTS-1', selected: true }, { key: 'PARTS-2', selected: true }]);

    expect(await draft.retain(['PARTS-2', 'PARTS-3'])).toEqual({ 'PARTS-2': { selected: true } });
    expect(await new OrderDraft({ file }).read()).toEqual({ 'PARTS-2': { selected: true } });
  });

  it('remove forgets submitted tickets, on disk too', async () => {
    const draft = new OrderDraft({ file });
    await draft.update([{ key: 'PARTS-1', selected: true }, { key: 'PARTS-2', selected: true }]);

    await draft.remove(['PARTS-1']);

    expect(await new OrderDraft({ file }).read()).toEqual({ 'PARTS-2': { selected: true } });
  });

  it('starts empty from a damaged file rather than failing the queue', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fs.writeFile(file, '{ not json');
    const draft = new OrderDraft({ file });

    expect(await draft.read()).toEqual({});
    await draft.update([{ key: 'PARTS-1', selected: true }]);
    expect(await new OrderDraft({ file }).read()).toEqual({ 'PARTS-1': { selected: true } });
  });

  describe('when the file cannot be written', () => {
    // A directory cannot be renamed over by a file.
    const blockedDraft = async () => {
      await fs.mkdir(file);
      return new OrderDraft({ file });
    };

    it('update rejects and does not pretend the change was kept', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const draft = await blockedDraft();

      await expect(draft.update([{ key: 'PARTS-1', selected: true }])).rejects.toThrow();

      expect(await draft.read()).toEqual({});
    });

    it('a failed save does not stop the next one running', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const draft = await blockedDraft();
      await expect(draft.update([{ key: 'PARTS-1', selected: true }])).rejects.toThrow();

      await fs.rm(file, { recursive: true });
      await draft.update([{ key: 'PARTS-2', selected: true }]);

      expect(await draft.read()).toEqual({ 'PARTS-2': { selected: true } });
    });

    it('clean-up never rejects: an order already written must not look failed', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const draft = new OrderDraft({ file });
      await draft.update([{ key: 'PARTS-1', selected: true }, { key: 'PARTS-2', selected: true }]);
      await fs.rm(file);
      await fs.mkdir(file);

      await expect(draft.remove(['PARTS-1'])).resolves.toEqual({
        'PARTS-1': { selected: true },
        'PARTS-2': { selected: true },
      });
      await expect(draft.retain(['PARTS-2'])).resolves.toBeDefined();
      expect(warn).toHaveBeenCalled();
    });
  });
});
