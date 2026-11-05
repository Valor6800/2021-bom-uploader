import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VersionStore } from '../../src/server/utils/versionStore.js';
import { BOMService } from '../../src/server/services/bomService.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'version-store-'));

describe('VersionStore', () => {
  it('keeps an answer across instances (a restart)', async () => {
    const dir = tmp();
    await new VersionStore({ dir }).set('v:a:b:c:', { bomTable: { items: [1] } });
    expect(await new VersionStore({ dir }).get('v:a:b:c:')).toEqual({ bomTable: { items: [1] } });
    expect(await new VersionStore({ dir }).get('v:other')).toBeNull();
  });

  it('reads a damaged file as nothing kept', async () => {
    const dir = tmp();
    const store = new VersionStore({ dir });
    await store.set('k', { x: 1 });
    for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), '{not json');
    expect(await store.get('k')).toBeNull();
  });

  it('lets the least recently used go past its limit', async () => {
    const dir = tmp();
    const store = new VersionStore({ dir, maxFiles: 2 });
    await store.set('a', 1);
    fs.utimesSync(path.join(dir, fs.readdirSync(dir)[0]), new Date(1000), new Date(1000));
    await store.set('b', 2);
    await store.set('c', 3);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.json'))).toHaveLength(2);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('c')).toBe(3);
  });

  it('never throws when it cannot write', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const file = path.join(tmp(), 'a-file');
    fs.writeFileSync(file, 'x');
    await expect(new VersionStore({ dir: path.join(file, 'below') }).set('k', 1)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('BOMService with a version store', () => {
  const D = 'd'.repeat(24); const V = 'e'.repeat(24); const E = 'f'.repeat(24);
  const raw = { bomTable: { headers: [], items: [] } };

  it('reads a version BOM kept on disk without asking OnShape', async () => {
    const dir = tmp();
    const store = new VersionStore({ dir });
    // As a server that ran before left it.
    await store.set(`v:${D}:${V}:${E}:kept-on-disk`, raw);
    const onshapeClient = { getAssemblyBOMAtVersion: jest.fn() };
    const table = await new BOMService({ onshapeClient, versionStore: store })
      .getRawBOM({ documentId: D, wvmType: 'v', wvmId: V, elementId: E, configuration: 'kept-on-disk' });
    expect(table).toEqual(raw.bomTable);
    expect(onshapeClient.getAssemblyBOMAtVersion).not.toHaveBeenCalled();
  });

  it('keeps what it reads from OnShape on disk', async () => {
    const dir = tmp();
    const store = new VersionStore({ dir });
    const onshapeClient = { getAssemblyBOMAtVersion: jest.fn().mockResolvedValue(raw) };
    await new BOMService({ onshapeClient, versionStore: store })
      .getRawBOM({ documentId: D, wvmType: 'v', wvmId: V, elementId: E, configuration: 'read-then-kept' });
    expect(onshapeClient.getAssemblyBOMAtVersion).toHaveBeenCalledTimes(1);
    let kept = null;
    for (let i = 0; i < 20 && !kept; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      kept = await store.get(`v:${D}:${V}:${E}:read-then-kept`);
      // eslint-disable-next-line no-await-in-loop
      if (!kept) await new Promise((r) => setTimeout(r, 10));
    }
    expect(kept).toEqual(raw);
  });
});
