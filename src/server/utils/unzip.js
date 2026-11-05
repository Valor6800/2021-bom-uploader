/**
 * The files in a zip (stored or deflated), from its central directory.
 * Enough for OnShape's export zips; no encryption, no zip64.
 */

import { inflateRawSync } from 'node:zlib';

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** True when the bytes are a zip (they start with a local file header). */
export function isZip(bytes) {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL;
}

/**
 * @param {Buffer} bytes
 * @returns {{ name: string, data: Buffer }[]}
 * @throws {Error} for bytes that aren't a zip it can read
 */
export function unzip(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (bytes.readUInt32LE(i) === END) { end = i; break; }
  }
  if (end < 0) throw new Error('Not a zip: no end of central directory');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);

  const files = [];
  for (let n = 0; n < count; n += 1) {
    if (bytes.readUInt32LE(at) !== CENTRAL) throw new Error('Bad zip: central directory entry');
    const method = bytes.readUInt16LE(at + 10);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;

    if (bytes.readUInt32LE(local) !== LOCAL) throw new Error('Bad zip: local file header');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) files.push({ name, data: Buffer.from(raw) });
    else if (method === 8) files.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`Zip method ${method} isn't supported`);
  }
  return files;
}
