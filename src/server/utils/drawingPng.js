/**
 * A drawing as one PNG, for the Part's ticket and the Assembly page: every
 * page of the PDF from `partDrawing` drawn by pdf.js onto one canvas, one
 * under the other (a long hole chart carries on below). Its text is drawn from pdf.js's own font
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
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await doc.getPage(i);
      pages.push({ page, viewport: page.getViewport({ scale }) });
    }
    const width = Math.ceil(Math.max(...pages.map((p) => p.viewport.width)));
    const height = Math.ceil(pages.reduce((h, p) => h + p.viewport.height, 0));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // Each page on its own canvas (pdf.js paints a page's background over
    // the whole canvas), then copied in under the one before.
    let top = 0;
    for (const { page, viewport } of pages) {
      const sheet = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const sctx = sheet.getContext('2d');
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, sheet.width, sheet.height);
      // eslint-disable-next-line no-await-in-loop
      await page.render({ canvasContext: sctx, viewport }).promise;
      ctx.drawImage(sheet, 0, top);
      top += sheet.height;
    }
    return canvas.toBuffer('image/png');
  } finally {
    await doc.destroy();
  }
}
