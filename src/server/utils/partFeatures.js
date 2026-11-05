/**
 * The key dimensions of the two kinds of part the tool draws, worked out
 * from OnShape's body details (the same read the Thickness and DXFs use, so
 * a drawing costs no OnShape call of its own):
 *
 * - A plate (a Part with a Thickness): its outline, and each round hole's
 *   size and where its centre is, measured from the lower left of the
 *   outline, the same origin as the DXF.
 * - An axle (a long part, round or hex across): its length, its cross
 *   section (hex across flats, diameter), any length of it turned to another
 *   size (a groove, a shoulder), bores into its ends and holes across it,
 *   each placed from its left end.
 *
 * Lengths here are millimetres; the drawing shows inches.
 */

import {
  add, analyzeBody, bodyPoints, dot, edgePoints, faceLayout, length, scale, sub, unit,
} from './partGeometry.js';

const METRES_TO_MM = 1000;
const MM_PER_INCH = 25.4;

/** An axle is at least this many times longer than it is across. */
const AXLE_ASPECT = 2;
/** Its two sizes across are within this ratio (a hex's flats/corners is 0.87). */
const ACROSS_RATIO = 0.8;
/** The cross sections an axle is made from. */
const AXLE_STOCK = new Set(['round', 'hex', 'rounded hex']);
/** Faces the finder can't explain may be at most this share of the part's area. */
const UNEXPLAINED_AREA = 0.2;
/** Parallel / square within this (cosine). */
const ALIGNED = 0.999;
const SQUARE = 1e-3;
/** Positions along the axle closer than this (metres) are the same position. */
const SAME_AT = 1e-5;
/** Sizes closer than this (metres) are the same size. */
const SAME_SIZE = 2e-5;

/**
 * Tap drills for the threads the team uses, so a hole of that size can say
 * what it is likely for. Inches.
 */
const TAP_DRILLS = [
  { thread: '#4-40', drill: 0.089, major: 0.112 },
  { thread: '#6-32', drill: 0.1065, major: 0.138 },
  { thread: '#8-32', drill: 0.136, major: 0.164 },
  { thread: '#10-24', drill: 0.1495, major: 0.19 },
  { thread: '#10-32', drill: 0.159, major: 0.19 },
  { thread: '1/4-20', drill: 0.201, major: 0.25 },
  { thread: '5/16-18', drill: 0.257, major: 0.3125 },
  { thread: '3/8-16', drill: 0.3125, major: 0.375 },
];
const TAP_TOLERANCE_IN = 0.002;

/**
 * A thread's outside (major) diameter, for drawing it.
 * @param {string} thread  e.g. "1/4-20"
 * @returns {number|null}  Millimetres
 */
export function threadMajor(thread) {
  const hit = TAP_DRILLS.find((t) => t.thread === thread);
  return hit ? hit.major * MM_PER_INCH : null;
}

/**
 * The thread a hole of this size is the tap drill for, if any.
 * @param {number} diameterMm
 * @returns {string|null}  e.g. "1/4-20"
 */
export function tapFor(diameterMm) {
  const inches = diameterMm / MM_PER_INCH;
  const hit = TAP_DRILLS.find((t) => Math.abs(t.drill - inches) <= TAP_TOLERANCE_IN);
  return hit?.thread ?? null;
}

// ---------------------------------------------------------------- plates

/**
 * A plate's outline and holes, laid out as its DXF is.
 *
 * Holes are grouped by size, largest first, and tagged A, B, C… within which
 * each hole is numbered from the lower left (A1, A2…).
 *
 * @param {object} body
 * @param {object} analysis  From `analyzeBody`
 * @param {Map<string, number[][]>} [curves]
 * @returns {{
 *   kind: 'plate', width: number, height: number, thickness: number,
 *   entities: Array, cutouts: number,
 *   holes: { tag: string, x: number, y: number, d: number, tap: string|null }[],
 *   groups: { letter: string, d: number, count: number, tap: string|null }[],
 * }}
 */
export function plateFeatures(body, analysis, curves) {
  const layout = faceLayout(body, analysis, curves);
  const sizes = [];
  for (const hole of layout.holes) {
    if (!sizes.some((d) => Math.abs(d - hole.d) < SAME_SIZE * METRES_TO_MM)) sizes.push(hole.d);
  }
  sizes.sort((a, b) => b - a);
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `Z${i - 25}`);
  const groupOf = (d) => sizes.findIndex((s) => Math.abs(s - d) < SAME_SIZE * METRES_TO_MM);

  const ordered = [...layout.holes].sort((a, b) => groupOf(a.d) - groupOf(b.d)
    || Math.round(a.y * 100) - Math.round(b.y * 100) || a.x - b.x);
  const counts = new Map();
  const holes = ordered.map((h) => {
    const g = groupOf(h.d);
    const n = (counts.get(g) ?? 0) + 1;
    counts.set(g, n);
    return { tag: `${letter(g)}${n}`, x: h.x, y: h.y, d: sizes[g], tap: tapFor(sizes[g]) };
  });

  return {
    kind: 'plate',
    width: layout.width,
    height: layout.height,
    thickness: analysis.thickness * METRES_TO_MM,
    entities: layout.entities,
    cutouts: layout.cutouts,
    holes,
    groups: sizes.map((d, i) => ({ letter: letter(i), d, count: counts.get(i) ?? 0, tap: tapFor(d) })),
  };
}

// ---------------------------------------------------------------- axles

/** Where along the axle a face runs, from its edges. */
function spanOf(face, edgesById, along) {
  let from = Infinity;
  let to = -Infinity;
  for (const loop of face.loops ?? []) {
    for (const { edgeId } of loop.coedges) {
      const edge = edgesById.get(edgeId);
      if (!edge) continue;
      for (const p of edgePoints(edge)) {
        const s = along(p);
        if (s < from) from = s;
        if (s > to) to = s;
      }
    }
  }
  return { from, to };
}

/** Merge spans of one size that touch or overlap. */
function mergeSpans(items) {
  const out = [];
  for (const item of [...items].sort((a, b) => a.from - b.from)) {
    const last = out.find((o) => Math.abs(o.d - item.d) < SAME_SIZE && item.from <= o.to + SAME_AT
      && (o.axis === undefined || o.axis === item.axis));
    if (last) last.to = Math.max(last.to, item.to);
    else out.push({ ...item });
  }
  return out;
}

const sameSection = (a, b) => a.shape === b.shape
  && Math.abs((a.acrossFlats ?? 0) - (b.acrossFlats ?? 0)) < SAME_SIZE
  && Math.abs((a.diameter ?? 0) - (b.diameter ?? 0)) < SAME_SIZE;

/** What the axle is like across at one place: its flats and its round faces there. */
function sectionAt(s, flats, rounds) {
  const here = flats.filter((f) => f.from <= s && s <= f.to);
  const normals = [];
  for (const f of here) {
    if (!normals.some((n) => dot(n, f.normal) > ALIGNED)) normals.push(f.normal);
  }
  const round = rounds.filter((r) => r.from <= s && s <= r.to);
  const diameter = round.length ? Math.max(...round.map((r) => r.d)) : null;
  const acrossFlats = here.length ? 2 * Math.min(...here.map((f) => f.distance)) : null;
  let shape = 'profile';
  if (normals.length === 0 && diameter) shape = 'round';
  else if (normals.length === 6) shape = diameter ? 'rounded hex' : 'hex';
  else if (normals.length === 4) shape = diameter ? 'rounded square' : 'square';
  return {
    shape,
    acrossFlats: normals.length ? acrossFlats : null,
    diameter: diameter ?? (shape === 'hex' ? acrossFlats / Math.cos(Math.PI / 6) : null),
  };
}

/**
 * The line an axle turns about, and where it starts and ends along it: the
 * axis of its largest round outside face, or, for a part with none (a sharp
 * hex), the long side of its box. Null when the part isn't long and narrow
 * and about as wide one way across as the other.
 */
function axisOf(body, analysis) {
  const round = (body.faces ?? [])
    .filter((f) => f.surface?.type === 'cylinder' && f.orientation !== false
      && Array.isArray(f.surface.axis) && Array.isArray(f.surface.origin))
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0];
  let A;
  let centre;
  if (round) {
    A = unit(round.surface.axis);
    centre = round.surface.origin;
  } else if (analysis) {
    const [long, wide, narrow] = analysis.axes;
    A = long.vec;
    centre = add(scale(wide.vec, (wide.min + wide.max) / 2), scale(narrow.vec, (narrow.min + narrow.max) / 2));
  } else {
    return null;
  }
  const points = bodyPoints(body);
  if (points.length === 0) return null;
  const s = points.map((p) => dot(p, A));
  const start = Math.min(...s);
  const L = Math.max(...s) - start;

  // How wide it is across, two ways square to the axis.
  const sideways = unit(Math.abs(A[0]) < 0.9 ? [0, -A[2], A[1]] : [-A[1], A[0], 0]);
  const other = [
    A[1] * sideways[2] - A[2] * sideways[1],
    A[2] * sideways[0] - A[0] * sideways[2],
    A[0] * sideways[1] - A[1] * sideways[0],
  ];
  const width = (v) => {
    const d = points.map((p) => dot(p, v));
    return Math.max(...d) - Math.min(...d);
  };
  const across = [width(sideways), width(other)].sort((a, b) => b - a);
  if (L < AXLE_ASPECT * across[0]) return null;
  if (across[1] < ACROSS_RATIO * across[0]) return null;
  return { A, centre, start, L, sideways };
}

/**
 * An axle's key dimensions, or null when the part isn't an axle: not long
 * and narrow, not round or hex across, or with faces this can't explain
 * (a bracket, a gear).
 *
 * @param {object} body
 * @param {object} [analysis]  From `analyzeBody`
 * @returns {null|{
 *   kind: 'axle', length: number,
 *   stock: { shape: string, acrossFlats: number|null, diameter: number|null },
 *   sections: { from: number, to: number, shape: string, acrossFlats: number|null, diameter: number|null }[],
 *   bores: { end: 'left'|'right'|'through', d: number, depth: number, tap: string|null }[],
 *   crossHoles: { at: number, d: number, tap: string|null }[],
 *   endView: object|null,
 * }}  Millimetres, positions from the left end
 */
export function axleFeatures(body, analysis = analyzeBody(body)) {
  const axis = axisOf(body, analysis);
  if (!axis) return null;
  const { A, centre, start, L, sideways } = axis;
  const along = (p) => dot(p, A) - start;
  const offAxis = (p) => {
    const d = sub(p, centre);
    return length(sub(d, scale(A, dot(d, A))));
  };
  const edgesById = new Map((body.edges ?? []).map((e) => [e.id, e]));

  const flats = [];
  const rounds = [];
  const bores = [];
  const cross = [];
  const ends = [];
  let total = 0;
  let unexplained = 0;
  for (const face of body.faces ?? []) {
    const area = face.area ?? 0;
    total += area;
    const surf = face.surface ?? {};
    const span = () => spanOf(face, edgesById, along);
    if (surf.type === 'plane') {
      const n = unit(surf.normal);
      const c = Math.abs(dot(n, A));
      if (c > ALIGNED) {
        ends.push({ face, at: along(surf.origin) });
      } else if (c < SQUARE) {
        // Its outward side, away from the axis.
        const out = dot(sub(surf.origin, centre), n) >= 0 ? n : scale(n, -1);
        flats.push({ ...span(), normal: out, distance: Math.abs(dot(sub(surf.origin, centre), n)) });
      } else {
        unexplained += area;
      }
    } else if (surf.type === 'cylinder') {
      const axis = unit(surf.axis);
      const c = Math.abs(dot(axis, A));
      const d = 2 * surf.radius;
      if (c > ALIGNED && offAxis(surf.origin) < SAME_SIZE) {
        // OnShape's cylinder points away from its axis: the face turned the
        // other way is the inside of a hole.
        (face.orientation === false ? bores : rounds).push({ ...span(), d });
      } else if (c < SQUARE && face.orientation === false) {
        cross.push({ at: along(surf.origin), d, axis: axis.map((v) => Math.round(Math.abs(v) * 1e3)).join(), from: along(surf.origin), to: along(surf.origin) });
      } else {
        unexplained += area;
      }
    } else if (surf.type !== 'cone' && surf.type !== 'torus') {
      // Chamfers (cones) and fillets (tori) are allowed but not dimensioned.
      unexplained += area;
    }
  }
  if (rounds.length === 0 && flats.length === 0) return null;
  if (total > 0 && unexplained / total > UNEXPLAINED_AREA) return null;

  // The axle's cross section between each place its outside changes.
  const cuts = [0, L];
  for (const f of [...flats, ...rounds]) cuts.push(Math.max(0, f.from), Math.min(L, f.to));
  cuts.sort((a, b) => a - b);
  const stations = cuts.filter((s, i) => i === 0 || s - cuts[i - 1] > SAME_AT);
  const sections = [];
  for (let i = 1; i < stations.length; i += 1) {
    const from = stations[i - 1];
    const to = stations[i];
    const section = { from, to, ...sectionAt((from + to) / 2, flats, rounds) };
    const last = sections[sections.length - 1];
    if (last && sameSection(last, section)) last.to = to;
    else sections.push(section);
  }
  const stock = sections.reduce((best, s) => {
    const len = sections.filter((t) => sameSection(t, s)).reduce((sum, t) => sum + t.to - t.from, 0);
    return !best || len > best.len ? { len, s } : best;
  }, null).s;
  if (!AXLE_STOCK.has(stock.shape)) return null;

  const boreList = mergeSpans(bores).map((b) => {
    const left = b.from < SAME_AT * 10;
    const right = b.to > L - SAME_AT * 10;
    let end = 'left';
    if (left && right) end = 'through';
    else if (right) end = 'right';
    return { end, d: b.d, depth: b.to - b.from };
  });
  const crossList = [];
  for (const h of cross) {
    if (!crossList.some((c) => Math.abs(c.at - h.at) < SAME_AT && Math.abs(c.d - h.d) < SAME_SIZE)) crossList.push(h);
  }

  // Seen from the left end: the end face, flat, with the axle's flats square to the page.
  const leftEnd = ends.filter((e) => e.at < SAME_AT * 10)
    .sort((a, b) => (b.face.area ?? 0) - (a.face.area ?? 0))[0];
  const endView = leftEnd
    ? faceLayout(body, { face: leftEnd.face, outward: scale(A, -1), longAxis: flats[0]?.normal ?? sideways })
    : null;

  const mmOf = (m) => m * METRES_TO_MM;
  const sectionMm = (s) => ({
    ...s,
    from: mmOf(s.from),
    to: mmOf(s.to),
    acrossFlats: s.acrossFlats == null ? null : mmOf(s.acrossFlats),
    diameter: s.diameter == null ? null : mmOf(s.diameter),
  });
  return {
    kind: 'axle',
    length: mmOf(L),
    stock: (({ shape, acrossFlats, diameter }) => ({ shape, acrossFlats, diameter }))(sectionMm(stock)),
    sections: sections.map(sectionMm),
    bores: boreList.map((b) => ({ ...b, d: mmOf(b.d), depth: mmOf(b.depth), tap: tapFor(mmOf(b.d)) })),
    crossHoles: crossList.sort((a, b) => a.at - b.at)
      .map((h) => ({ at: mmOf(h.at), d: mmOf(h.d), tap: tapFor(mmOf(h.d)) })),
    endView,
  };
}
