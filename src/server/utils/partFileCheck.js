/**
 * Which of the files the cut puts on a Part are missing from its ticket:
 * its picture (`<number>.png`), its drawings (`<number>_drawings.pdf`), a
 * 3D print's STEP and a routed plate's DXF. Pure.
 *
 * Only the files every Part of its kind gets are asked for: a turned or
 * milled part may rightly have no DXF, so only a CNC Router part must have one.
 */

import { Machinery } from './bomConstants.js';

/** What a missing file is called on the page. */
export const FileKind = Object.freeze({
  PICTURE: 'picture',
  DRAWING: 'drawing',
  STEP: 'STEP',
  DXF: 'DXF',
});

/** The files a Part is made from, by the tool's own names (what the copy for a spare takes). */
export function isPartFile(filename, partNumber) {
  const name = String(filename ?? '');
  return !!partNumber && name.startsWith(partNumber) && /\.(png|pdf|dxf|step)$/i.test(name)
    // "VR26P-2204C.png", "VR26P-2204C_drawing_REAR.png", not another Part's "VR26P-2204CX.png".
    && /^[_.]/.test(name.slice(partNumber.length));
}

/**
 * @param {{ fullPartNumber?: string, machinery?: string, files?: string[] }} part
 * @returns {string[]|null}  The kinds missing (empty: none); null when its files aren't known
 */
export function missingFiles({ fullPartNumber, machinery, files }) {
  if (!Array.isArray(files) || !fullPartNumber) return null;
  const mine = files.filter((f) => isPartFile(f, fullPartNumber));
  const has = (re) => mine.some((f) => re.test(f.slice(fullPartNumber.length)));
  const out = [];
  if (!has(/^\.png$/i)) out.push(FileKind.PICTURE);
  if (!has(/^_drawings\.pdf$/i)) out.push(FileKind.DRAWING);
  if (machinery === Machinery.THREE_D_PRINTER && !has(/\.step$/i)) out.push(FileKind.STEP);
  if (machinery === Machinery.CNC_ROUTER && !has(/\.dxf$/i)) out.push(FileKind.DXF);
  return out;
}
