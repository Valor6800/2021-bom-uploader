/**
 * A one-page shop drawing (PDF, US Letter, landscape) of a plate or an axle,
 * from `partFeatures`. It shows what the shop needs to make the part right:
 *
 * - Plate: the outline to scale, every round hole tagged, a hole chart of
 *   each hole's size and centre measured from the lower left (the DXF's
 *   origin), the overall size and the thickness. Cutouts other than round
 *   holes are drawn but not dimensioned: they are cut from the DXF.
 * - Axle: a side view and an end view to scale, the length, the stock
 *   across, where anything along it starts and ends (from the left end),
 *   bores into the ends and holes across it, each with its size.
 *
 * Inches throughout, three places.
 */

import PDFDocument from 'pdfkit';

const MM_PER_INCH = 25.4;
const PAGE = { w: 792, h: 612 };
const M = 24;
const TITLE = { x: PAGE.w - M - 288, y: PAGE.h - M - 72, w: 288, h: 72 };
const THIN = 0.4;
const PART = 0.9;
const INK = '#000000';
const DIM = '#1f4e9a';
const WARN = '#b00020';
/** A colour per pocket depth, shallowest first. */
const POCKET_INK = ['#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#ad1457'];

const inches = (mm) => mm / MM_PER_INCH;
/** As the pocket DXFs are named: "0.125", "0.3125". */
const depthLabel = (mm) => { const s4 = inches(mm).toFixed(4); return s4.endsWith('0') ? s4.slice(0, -1) : s4; };
const fmt = (mm) => inches(mm).toFixed(3);

/** "1/2" for 0.5 in, when a size is a whole number of sixteenths; else "0.531". */
export function fraction(mm) {
  const value = inches(mm);
  const sixteenths = Math.round(value * 16);
  if (sixteenths === 0 || Math.abs(value - sixteenths / 16) > 0.001) return value.toFixed(3);
  const whole = Math.floor(sixteenths / 16);
  let n = sixteenths % 16;
  let d = 16;
  while (n && n % 2 === 0) { n /= 2; d /= 2; }
  if (!n) return String(whole);
  return whole ? `${whole} ${n}/${d}` : `${n}/${d}`;
}

/** A tapped hole's callout: "Tap 1/4-20 through", "Tap #10-32 x 0.500 deep". */
function holeNote(h, { bothEnds = false } = {}) {
  if (!h?.tap) return '';
  const depth = h.tapDepth ? ` x ${fmt(h.tapDepth)} deep` : ' through';
  return `Tap ${h.tap}${bothEnds && h.tapDepth ? ' both ends' : ''}${depth}`;
}

/**
 * What the drawing says about tapping. Which holes are tapped comes from
 * OnShape's Hole feature, never a hole's size (0.201 in is a 1/4-20 tap
 * drill and a #10 clearance hole). The cut sets Needs Tapping? to Yes when
 * the Hole feature has a tapped hole, so the two can only disagree when
 * the Part says Yes and the model has none: then the drawing says so.
 *
 * @param {object} f        From `plateFeatures` or `axleFeatures`
 * @param {string} [tapping]  The Part's Needs Tapping?: "Yes" or "No"
 * @returns {{ text: string, warn?: boolean }[]}
 */
export function tapNotes(f, tapping) {
  const found = f.kind !== 'axle'
    ? f.groups.filter((g) => g.tap).map((g) => ({ what: `${g.count} ${g.letter} hole${g.count === 1 ? '' : 's'}`, h: g }))
    : [
      ...f.bores.filter((b) => b.tap).map((b) => ({ what: b.end === 'through' ? 'the bore' : `the ${b.end} end bore`, h: b, bothEnds: b.end === 'through' })),
      ...f.crossHoles.filter((h) => h.tap).map((h) => ({ what: `the cross hole at ${fmt(h.at)}`, h })),
    ];
  if (found.length) {
    return found.map(({ what, h, bothEnds }) => ({
      text: `${holeNote(h, { bothEnds }).replace(/^Tap /, `Tap ${what} `)} (drilled Ø${fmt(h.d)}).`,
    }));
  }
  if (tapping === 'Yes') {
    return [{
      text: f.holeData
        ? 'Needs Tapping? is Yes, but no hole in the model is a tapped Hole: ask the designer which holes to tap.'
        : 'Needs Tapping? is Yes, but the model could not be read for its tapped holes: ask the designer which to tap.',
      warn: true,
    }];
  }
  return [];
}

/** Set the font and size, smaller until `text` fits `width`; cut short with "..." if it still doesn't. */
function fitted(doc, text, { font, size, min, width }) {
  doc.font(font);
  let pt = size;
  doc.fontSize(pt);
  while (pt > min && doc.widthOfString(text) > width) {
    pt -= 0.5;
    doc.fontSize(pt);
  }
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}...`) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

/** A thread's symbol: three quarters of a thin circle at its outside diameter. */
function threadMark(doc, x, y, r) {
  doc.save().lineWidth(THIN).strokeColor(INK)
    .path(`M ${x + r} ${y} A ${r} ${r} 0 1 0 ${x} ${y + r}`).stroke().restore();
}

// ---------------------------------------------------------------- drawing pieces

function arrow(doc, x, y, dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = 5;
  doc.polygon([x, y], [x - ux * s - uy * s * 0.35, y - uy * s + ux * s * 0.35],
    [x - ux * s + uy * s * 0.35, y - uy * s - ux * s * 0.35]).fill(DIM);
}

/** A horizontal dimension between x1 and x2, its line at y, measured from points at `from`. */
function dimH(doc, x1, x2, y, fromY, text) {
  doc.save().lineWidth(THIN).strokeColor(DIM);
  doc.moveTo(x1, fromY).lineTo(x1, y + 3 * Math.sign(y - fromY || 1)).stroke();
  doc.moveTo(x2, fromY).lineTo(x2, y + 3 * Math.sign(y - fromY || 1)).stroke();
  doc.moveTo(x1, y).lineTo(x2, y).stroke();
  arrow(doc, x1, y, -1, 0);
  arrow(doc, x2, y, 1, 0);
  doc.fillColor(DIM).font('Helvetica').fontSize(8);
  const w = doc.widthOfString(text);
  const mid = (x1 + x2) / 2;
  doc.rect(mid - w / 2 - 2, y - 5, w + 4, 10).fill('#ffffff');
  doc.fillColor(DIM).text(text, mid - w / 2, y - 3.5, { lineBreak: false });
  doc.restore();
}

/** A vertical dimension between y1 and y2, its line at x, measured from points at `fromX`. */
function dimV(doc, y1, y2, x, fromX, text) {
  doc.save().lineWidth(THIN).strokeColor(DIM);
  doc.moveTo(fromX, y1).lineTo(x - 3, y1).stroke();
  doc.moveTo(fromX, y2).lineTo(x - 3, y2).stroke();
  doc.moveTo(x, y1).lineTo(x, y2).stroke();
  arrow(doc, x, Math.min(y1, y2), 0, -1);
  arrow(doc, x, Math.max(y1, y2), 0, 1);
  doc.font('Helvetica').fontSize(8);
  const w = doc.widthOfString(text);
  const mid = (y1 + y2) / 2;
  doc.rotate(-90, { origin: [x, mid] });
  doc.rect(x - w / 2 - 2, mid - 5, w + 4, 10).fill('#ffffff');
  doc.fillColor(DIM).text(text, x - w / 2, mid - 3.5, { lineBreak: false });
  doc.restore();
}

/** Draw `partGeometry.faceLayout` entities (mm, y up) with a placement. */
function drawEntities(doc, entities, px, py, k, { width = PART, color = INK, dash = false } = {}) {
  doc.save().lineWidth(width).strokeColor(color);
  if (dash) doc.dash(3, { space: 2 });
  for (const [kind, ...args] of entities) {
    if (kind === 'LINE') {
      const [a, b] = args;
      doc.moveTo(px(a[0]), py(a[1])).lineTo(px(b[0]), py(b[1])).stroke();
    } else if (kind === 'CIRCLE') {
      const [c, r] = args;
      doc.circle(px(c[0]), py(c[1]), r * k).stroke();
    } else {
      // An ARC runs counter-clockwise (y up) from its start to its end angle.
      const [c, r, start, end] = args;
      const rad = (deg) => (deg * Math.PI) / 180;
      const sweep = (((end - start) % 360) + 360) % 360;
      const sx = px(c[0] + r * Math.cos(rad(start)));
      const sy = py(c[1] + r * Math.sin(rad(start)));
      const ex = px(c[0] + r * Math.cos(rad(end)));
      const ey = py(c[1] + r * Math.sin(rad(end)));
      const R = r * k;
      // y is flipped on the page, so counter-clockwise there is SVG sweep 0.
      doc.path(`M ${sx} ${sy} A ${R} ${R} 0 ${sweep > 180 ? 1 : 0} 0 ${ex} ${ey}`).stroke();
    }
  }
  doc.restore();
}

function centreMark(doc, x, y, size) {
  doc.save().lineWidth(THIN).strokeColor(DIM);
  doc.moveTo(x - size, y).lineTo(x + size, y).stroke();
  doc.moveTo(x, y - size).lineTo(x, y + size).stroke();
  doc.restore();
}

function frame(doc, { partNumber, description, made }) {
  doc.lineWidth(1).strokeColor(INK).rect(M, M, PAGE.w - 2 * M, PAGE.h - 2 * M).stroke();
  const t = TITLE;
  doc.lineWidth(0.8).rect(t.x, t.y, t.w, t.h).stroke();
  doc.moveTo(t.x, t.y + 28).lineTo(t.x + t.w, t.y + 28).stroke();
  const width = t.w - 16;
  const number = fitted(doc, partNumber, { font: 'Helvetica-Bold', size: 16, min: 9, width });
  doc.fillColor(INK).text(number, t.x + 8, t.y + 7 + (16 - doc._fontSize) / 2, { lineBreak: false });
  const words = fitted(doc, description, { font: 'Helvetica', size: 8.5, min: 6, width });
  doc.text(words, t.x + 8, t.y + 34, { lineBreak: false });
  doc.font('Helvetica').fontSize(7).fillColor('#333333')
    .text('Inches. Do not scale the drawing: work to the dimensions.', t.x + 8, t.y + 47, { lineBreak: false })
    .text(`Made by ValorBOM from the OnShape model, ${made}.`, t.x + 8, t.y + 57, { lineBreak: false });
}

/** Numbered notes, bottom left, above the page's edge. A warning is red. */
function notes(doc, lines, bottom) {
  const items = lines.map((l) => (typeof l === 'string' ? { text: l } : l));
  const top = bottom - 11 - items.length * 10;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text('NOTES', M + 10, top, { lineBreak: false });
  items.forEach((item, i) => {
    const text = fitted(doc, `${i + 1}. ${item.text}`, {
      font: item.warn ? 'Helvetica-Bold' : 'Helvetica', size: 7.5, min: 6, width: TITLE.x - M - 24,
    });
    doc.fillColor(item.warn ? WARN : INK).text(text, M + 10, top + 11 + i * 10, { lineBreak: false });
  });
}

/** A table of rows; returns how many rows fit before `bottom`. */
function table(doc, { x, y, columns, rows, bottom, title }) {
  const rowH = 9;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text(title, x, y, { lineBreak: false });
  let cy = y + 11;
  let cx = x;
  doc.fontSize(6.5);
  for (const c of columns) {
    doc.text(c.label, cx + 2, cy + 1.5, { width: c.w - 4, align: c.align ?? 'left', lineBreak: false });
    cx += c.w;
  }
  const width = columns.reduce((s, c) => s + c.w, 0);
  doc.lineWidth(THIN).strokeColor(INK).moveTo(x, cy + rowH).lineTo(x + width, cy + rowH).stroke();
  cy += rowH + 1;
  doc.font('Helvetica');
  let fitted = 0;
  for (const row of rows) {
    if (cy + rowH > bottom) break;
    cx = x;
    row.forEach((cell, i) => {
      const c = columns[i];
      const text = typeof cell === 'object' && cell ? cell.text : String(cell ?? '');
      doc.fillColor(cell?.color ?? INK)
        .text(text, cx + 2, cy + 1.5, { width: c.w - 4, align: c.align ?? 'left', lineBreak: false });
      cx += c.w;
    });
    doc.fillColor(INK);
    cy += rowH;
    fitted += 1;
  }
  return fitted;
}

// ---------------------------------------------------------------- plate

const HOLE_COLUMNS = [
  { label: 'HOLE', w: 34 },
  { label: 'X', w: 46, align: 'right' },
  { label: 'Y', w: 46, align: 'right' },
  { label: 'SIZE', w: 46, align: 'right' },
];

/** What a plate or face drawing is of, for its title block. */
function sheetName(f, meta) {
  const material = meta.material ? `, ${meta.material}` : '';
  if (f.kind === 'plate') {
    return `Plate, ${fraction(f.thickness)} in thick${material}${f.rear ? ', rear side' : ''}. ${fmt(f.width)} x ${fmt(f.height)}.`;
  }
  const stock = f.stock?.length ? ` Stock ${f.stock.map(fmt).join(' x ')}${material}.` : '';
  return `${f.side ?? 'Face'} side, ${fmt(f.width)} x ${fmt(f.height)}.${stock}`;
}

function drawPlate(doc, f, meta) {
  frame(doc, { ...meta, description: sheetName(f, meta) });

  // The hole chart down the right; the plate to scale in what's left.
  const chartX = PAGE.w - M - 8 - HOLE_COLUMNS.reduce((s, c) => s + c.w, 0) - 60;
  const area = { x: M + 48, y: M + 24, w: chartX - M - 48 - 24, h: TITLE.y - M - 24 - 90 };
  const k = Math.min(area.w / f.width, area.h / f.height);
  const ox = area.x + (area.w - f.width * k) / 2;
  const oy = area.y + (area.h + f.height * k) / 2;
  const px = (x) => ox + x * k;
  const py = (y) => oy - y * k;

  // Pocket floors, thin and shaded by depth, under the outline.
  const pockets = f.pockets ?? [];
  pockets.forEach((p, i) => {
    drawEntities(doc, p.entities, px, py, k, { width: THIN, color: POCKET_INK[i % POCKET_INK.length], dash: p.back });
  });
  drawEntities(doc, f.entities, px, py, k);
  doc.font('Helvetica').fontSize(Math.max(4.5, Math.min(7, k * 2)));
  for (const h of f.holes) {
    const r = (h.d / 2) * k;
    centreMark(doc, px(h.x), py(h.y), Math.max(2, r * 0.6));
    if (h.tap && h.major) threadMark(doc, px(h.x), py(h.y), (h.major / 2) * k);
    doc.fillColor(DIM).text(h.tag, px(h.x) + r * 0.75 + 0.5, py(h.y) - r * 0.75 - 6, { lineBreak: false });
  }
  // The origin every hole is measured from.
  doc.save().lineWidth(THIN).strokeColor(DIM).circle(px(0), py(0), 3).stroke().restore();
  doc.fillColor(DIM).fontSize(7).text('0,0', px(0) - 16, py(0) + 3, { lineBreak: false });

  dimH(doc, px(0), px(f.width), py(0) + 22, py(0) + 8, fmt(f.width));
  dimV(doc, py(0), py(f.height), px(0) - 26, px(0) - 12, fmt(f.height));

  const groups = f.groups.map((g) => [
    g.letter, `Ø${fmt(g.d)}`, `x${g.count}`, holeNote(g),
  ]);
  const sizeColumns = [
    { label: 'HOLE', w: 34 }, { label: 'SIZE', w: 50, align: 'right' },
    { label: 'QTY', w: 30, align: 'right' }, { label: 'NOTE', w: 118 },
  ];
  const chartTop = M + 14;
  let locTop = chartTop;
  if (groups.length) {
    table(doc, { x: chartX, y: chartTop, columns: sizeColumns, rows: groups, bottom: TITLE.y - 10, title: 'HOLE SIZES' });
    locTop += 24 + groups.length * 9 + 10;
  }
  if (pockets.length) {
    const rows = pockets.map((p, i) => [
      { text: `${depthLabel(p.depth)} deep`, color: POCKET_INK[i % POCKET_INK.length] },
      p.back ? 'from the back' : 'from this side',
      `_${p.file ?? `POCKET_${depthLabel(p.depth)}.dxf`}`,
    ]);
    table(doc, {
      x: chartX, y: locTop, title: 'POCKETS (OUTLINES IN COLOUR)',
      columns: [{ label: 'DEPTH', w: 64 }, { label: 'CUT', w: 64 }, { label: 'DXF', w: 104 }],
      rows, bottom: TITLE.y - 10,
    });
    locTop += 24 + pockets.length * 9 + 10;
  }
  const rows = f.holes.map((h) => [h.tag, fmt(h.x), fmt(h.y), `Ø${fmt(h.d)}`]);
  let done = rows.length ? table(doc, {
    x: chartX, y: locTop, columns: HOLE_COLUMNS, rows, bottom: TITLE.y - 10, title: 'HOLE CENTRES FROM 0,0',
  }) : 0;

  const lines = [
    f.kind === 'face' && f.plain
      ? 'Nothing to cut on this side (no DXF): it shows the size of the stock.'
      : null,
    f.kind === 'face' ? `Seen from the ${String(f.side ?? 'face').toLowerCase()} side of the part.` : null,
    f.holes.length ? 'Hole centres are measured from 0,0, the lower left of the part (the DXF\'s origin).' : null,
    f.rear ? 'Seen from the rear: what is cut from the back. Its DXFs (_REAR, _REAR_POCKET_…) are seen from here too.' : null,
    pockets.length && !f.rear ? 'Seen from the side the pockets are cut from. Pocket depths are from that face; each depth\'s outline is its own DXF.' : null,
    f.cutouts ? `${f.cutouts} cutout${f.cutouts === 1 ? '' : 's'} other than round holes ${f.cutouts === 1 ? 'is' : 'are'} not dimensioned: cut from the DXF.` : null,
    ...tapNotes(f, meta.tapping),
    done < rows.length ? `The hole chart continues below (${rows.length} holes).` : null,
  ].filter(Boolean);
  notes(doc, lines, PAGE.h - M - 8);

  // More holes than fit: carry on, three columns a page.
  while (done < rows.length) {
    doc.addPage();
    frame(doc, { ...meta, description: `${sheetName(f, meta)} Hole chart, continued.` });
    for (let col = 0; col < 3 && done < rows.length; col += 1) {
      done += table(doc, {
        x: M + 16 + col * 190, y: M + 14, columns: HOLE_COLUMNS, rows: rows.slice(done),
        bottom: col === 2 ? TITLE.y - 10 : PAGE.h - M - 10, title: 'HOLE CENTRES FROM 0,0 (continued)',
      });
    }
  }
}

// ---------------------------------------------------------------- axle

const isHex = (s) => s.shape === 'hex' || s.shape === 'rounded hex';

function stockWords(s) {
  if (s.shape === 'round') return `Ø${fmt(s.diameter)} round`;
  const across = `${fraction(s.acrossFlats)} hex (${fmt(s.acrossFlats)} across flats`;
  return s.shape === 'rounded hex' ? `${across}, Ø${fmt(s.diameter)} over the rounded corners)` : `${across})`;
}

/** Half its height seen square to a flat (a hex shows its corners), and where the flat's edges show. */
function sideOf(s) {
  if (!isHex(s)) return { half: s.diameter / 2, edges: null };
  const corner = s.acrossFlats / 2 / Math.cos(Math.PI / 6);
  const r = s.shape === 'rounded hex' ? Math.min(s.diameter / 2, corner) : corner;
  return { half: r, edges: Math.sqrt(Math.max(0, r * r - (s.acrossFlats / 2) ** 2)) };
}

function drawAxle(doc, f, meta) {
  frame(doc, {
    ...meta,
    description: `Axle, ${isHex(f.stock) ? `${fraction(f.stock.acrossFlats)} ${f.stock.shape}` : `Ø${fmt(f.stock.diameter)} round`}`
      + `${meta.material ? `, ${meta.material}` : ''}. ${fmt(f.length)} long.`,
  });

  const maxHalf = Math.max(...f.sections.map((s) => sideOf(s).half));
  const side = { x: M + 40, y: M + 40, w: 500, h: 170 };
  const k = Math.min(side.w / f.length, side.h / (2 * maxHalf));
  const ox = side.x;
  const cy = side.y + side.h / 2;
  const px = (s) => ox + s * k;

  // Side view: each length of it, outline and the flats' edges.
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text('SIDE VIEW', ox, side.y - 14, { lineBreak: false });
  doc.save().lineWidth(PART).strokeColor(INK);
  for (const s of f.sections) {
    const { half, edges } = sideOf(s);
    doc.rect(px(s.from), cy - half * k, (s.to - s.from) * k, 2 * half * k).stroke();
    if (edges) {
      doc.save().lineWidth(THIN);
      doc.moveTo(px(s.from), cy - edges * k).lineTo(px(s.to), cy - edges * k).stroke();
      doc.moveTo(px(s.from), cy + edges * k).lineTo(px(s.to), cy + edges * k).stroke();
      doc.restore();
    }
  }
  doc.restore();
  // Bores, hidden.
  doc.save().lineWidth(THIN).strokeColor(INK).dash(3, { space: 2 });
  for (const b of f.bores) {
    const from = b.end === 'right' ? f.length - b.depth : 0;
    const to = b.end === 'left' ? b.depth : f.length;
    for (const sign of [-1, 1]) doc.moveTo(px(from), cy + sign * (b.d / 2) * k).lineTo(px(to), cy + sign * (b.d / 2) * k).stroke();
    if (b.end !== 'through') {
      const x = px(b.end === 'left' ? to : from);
      doc.moveTo(x, cy - (b.d / 2) * k).lineTo(x, cy + (b.d / 2) * k).stroke();
    }
  }
  doc.undash().restore();
  for (const h of f.crossHoles) {
    doc.save().lineWidth(PART).strokeColor(INK).circle(px(h.at), cy, (h.d / 2) * k).stroke().restore();
  }
  // Centre line.
  doc.save().lineWidth(THIN).strokeColor(DIM).dash(10, { space: 3 })
    .moveTo(px(0) - 12, cy).lineTo(px(f.length) + 12, cy).stroke().undash().restore();

  // Where things are along it, from the left end, and how long it is.
  const bottom = cy + maxHalf * k;
  const stations = new Map();
  const mark = (at, why) => { const key = at.toFixed(3); if (!stations.has(key)) stations.set(key, { at, why }); };
  f.sections.slice(1).forEach((s) => mark(s.from, 'change'));
  f.crossHoles.forEach((h) => mark(h.at, 'hole'));
  f.bores.filter((b) => b.end !== 'through').forEach((b) => mark(b.end === 'left' ? b.depth : f.length - b.depth, 'bore'));
  const ordinateY = bottom + 26;
  if (stations.size) {
    doc.save().lineWidth(THIN).strokeColor(DIM).fillColor(DIM).font('Helvetica').fontSize(7);
    const marks = [{ at: 0 }, ...stations.values()].sort((a, b) => a.at - b.at);
    let lastX = -Infinity;
    let lastRight = true;
    for (const { at } of marks) {
      const x = px(at);
      doc.moveTo(x, bottom + 4).lineTo(x, ordinateY).stroke();
      const text = fmt(at);
      // Beside its line, reading up: to the left, or to the right when the
      // last one is too close to share the space.
      const right = x - lastX < 10 && !lastRight;
      lastX = x;
      lastRight = right;
      doc.save().rotate(-90, { origin: [x, ordinateY + 2] })
        .text(text, x - doc.widthOfString(text) - 2, ordinateY + 2 + (right ? 1.5 : -8.5), { lineBreak: false }).restore();
    }
    doc.restore();
  }
  dimH(doc, px(0), px(f.length), ordinateY + (stations.size ? 44 : 0), bottom + 4, fmt(f.length));

  // Each length's size, above it.
  doc.fillColor(DIM).font('Helvetica').fontSize(7);
  if (f.sections.length > 1) {
    for (const s of f.sections) {
      const { half } = sideOf(s);
      const text = isHex(s) ? `${fmt(s.acrossFlats)} A/F` : `Ø${fmt(s.diameter)}`;
      const w = doc.widthOfString(text);
      // A length too short to hold its label (a groove) is in the table.
      if ((s.to - s.from) * k < w + 4) continue;
      doc.text(text, (px(s.from) + px(s.to)) / 2 - w / 2, cy - half * k - 11, { lineBreak: false });
    }
  }

  // End view, from the left end, as big as fits.
  const ev = f.endView;
  if (ev) {
    const box = { x: side.x + side.w + 50, y: side.y, w: PAGE.w - M - 30 - (side.x + side.w + 50), h: 150 };
    const k2 = Math.min(box.w / ev.width, box.h / ev.height);
    const ex = box.x + (box.w - ev.width * k2) / 2;
    const ey = box.y + (box.h + ev.height * k2) / 2;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text('END VIEW (LEFT END, ENLARGED)', box.x, side.y - 14, { lineBreak: false });
    drawEntities(doc, ev.entities, (x) => ex + x * k2, (y) => ey - y * k2, k2);
    // A tapped bore shows its thread.
    const bore = f.bores.find((b) => b.tap && b.major && b.end !== 'right');
    if (bore) {
      for (const h of ev.holes.filter((e) => Math.abs(e.d - bore.d) < 0.05)) {
        threadMark(doc, ex + h.x * k2, ey - h.y * k2, (bore.major / 2) * k2);
      }
    }
    const end = f.sections[0];
    const stockText = isHex(end) ? `${fmt(end.acrossFlats)} A/F` : `Ø${fmt(end.diameter)}`;
    dimH(doc, ex, ex + ev.width * k2, ey + 18, ey + 3, stockText);
  }

  // Everything, in words.
  const rows = [['Length', fmt(f.length), ''], ['Stock', stockWords(f.stock), '']];
  if (f.sections.length > 1) {
    for (const s of f.sections) {
      rows.push([`${fmt(s.from)} to ${fmt(s.to)}`, stockWords(s), `${fmt(s.to - s.from)} long`]);
    }
  }
  for (const b of f.bores) {
    const where = { through: 'Through bore', left: 'Bore, left end', right: 'Bore, right end' }[b.end];
    rows.push([where, `Ø${fmt(b.d)}${b.end === 'through' ? ' through' : ` x ${fmt(b.depth)} deep`}`,
      holeNote(b, { bothEnds: b.end === 'through' })]);
  }
  for (const h of f.crossHoles) rows.push([`Cross hole at ${fmt(h.at)}`, `Ø${fmt(h.d)} through`, holeNote(h)]);
  table(doc, {
    x: M + 40, y: ordinateY + 70, title: 'FEATURES (POSITIONS FROM THE LEFT END)',
    columns: [{ label: 'WHAT', w: 130 }, { label: 'SIZE', w: 290 }, { label: 'NOTE', w: 110 }],
    rows, bottom: TITLE.y - 50,
  });

  notes(doc, [
    'Positions along the axle are measured from its left end, as drawn.',
    'Chamfers and fillets are not dimensioned.',
    ...tapNotes(f, meta.tapping),
  ], PAGE.h - M - 8);
}

// ---------------------------------------------------------------- the PDF

/**
 * One drawing as a PDF (a long hole chart runs onto more pages).
 *
 * @param {object} features  From `plateFeatures`, `faceFeatures` or `axleFeatures`
 * @param {object} meta
 * @param {string} meta.partNumber
 * @param {string} [meta.material]
 * @param {string} [meta.tapping]  The Part's Needs Tapping? (Yes with no tapped Hole in the model is flagged)
 * @param {Date}   [meta.date]
 * @returns {Promise<Buffer>}
 */
export function drawingPdf(features, meta) {
  return drawingsPdf([features], meta);
}

/**
 * Every drawing of a part in one PDF, one after the other.
 *
 * @param {object[]} list  From `plateFeatures`, `faceFeatures` or `axleFeatures`
 * @param {object} meta    As `drawingPdf`
 * @returns {Promise<Buffer>}
 */
export function drawingsPdf(list, { partNumber, material, tapping, date = new Date() }) {
  const doc = new PDFDocument({
    size: 'LETTER', layout: 'landscape', margin: 0, info: { Title: `${partNumber} drawings`, Creator: 'ValorBOM' },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const meta = { partNumber, material, tapping, made: date.toISOString().slice(0, 10) };
  list.forEach((features, i) => {
    if (i > 0) doc.addPage();
    if (features.kind === 'axle') drawAxle(doc, features, meta);
    else drawPlate(doc, features, meta);
  });
  doc.end();
  return done;
}
