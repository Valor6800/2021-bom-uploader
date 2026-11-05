/**
 * A drawing's first page as a PNG, for the Part's ticket and the Assembly
 * page: the PDF from `partDrawing` drawn by pdf.js onto a canvas, so the
 * picture is exactly what prints. Its text is drawn from pdf.js's own font
 * files, so the server needs no fonts installed.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
const PDFJS = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const FONTS = `${path.join(path.dirname(PDFJS), '..', '..', 'standard_fonts')}${path.sep}`;

/** pdf.js is large: loaded the first time a drawing is made, not at start. */
let pdfjs = null;

/**
 * @param {Buffer} pdf
 * @param {{ scale?: number }} [options]  Pixels per point (2: a Letter page is 1584 x 1224)
 * @returns {Promise<Buffer>}
 */
export async function pngOfPdf(pdf, { scale = 2 } = {}) {
  pdfjs ??= await import(PDFJS);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: FONTS,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await doc.destroy();
  }
}
