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

import { tappedByEntity } from './holeFeatures.js';
import { isPlain } from './partViews.js';
import {
  add, analyzeBody, bodyPoints, depthName, dot, edgePoints, faceLayout, length, plateViews, scale, sub, unit,
} from './partGeometry.js';

const METRES_TO_MM = 1000;

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

/** A tapped hole as the drawing shows it: its thread, its outside diameter and depth (mm; null: through). */
function tapInfo(hole) {
  if (!hole) return { tap: null, major: null, tapDepth: null };
  return {
    tap: hole.tapSize ?? 'tapped',
    major: hole.major ? hole.major * METRES_TO_MM : null,
    tapDepth: hole.through || !hole.depth ? null : hole.depth * METRES_TO_MM,
  };
}

// ---------------------------------------------------------------- plates

/**
 * A plate's outline, holes and pockets, laid out as its DXFs are (seen from
 * the side its pockets are cut from, with the profile's 0,0).
 *
 * Holes are the round through holes, grouped by size and thread (a tapped
 * 0.201 is not a #10 clearance 0.201), largest first, and tagged A, B, C…
 * within which each is numbered from the lower left (A1, A2…). Which are
 * tapped comes from OnShape's Hole feature (`holes`, from `holeFeatures`);
 * without it none is. Pockets are the partial-depth floors, one per depth.
 *
 * @param {object} body
 * @param {object} analysis  From `analyzeBody`
 * @param {Map<string, number[][]>} [curves]
 * @param {object[]|null} [holes]  This part's hole faces from `holesByPart`; null: not read
 * @returns {{
 *   kind: 'plate', width: number, height: number, thickness: number,
 *   entities: Array, cutouts: number, holeData: boolean,
 *   holes: { tag: string, x: number, y: number, d: number, tap: string|null, major: number|null, tapDepth: number|null }[],
 *   groups: { letter: string, d: number, count: number, tap: string|null, major: number|null, tapDepth: number|null }[],
 *   pockets: { depth: number, back: boolean, entities: Array }[],
 * }}
 */
export function plateFeatures(body, analysis, curves, holeFaces = null, { rear = false } = {}) {
  const { profile: main, pockets } = plateViews(body, analysis);
  // The rear drawing is the same plate seen from the back.
  const profile = rear ? { ...main, outward: main.outward.map((v) => -v) } : main;
  const face = faceFeatures(body, profile, curves, holeFaces, analysis);
  return {
    ...face,
    kind: 'plate',
    rear,
    thickness: analysis.thickness * METRES_TO_MM,
    // Pockets cut from the other side are drawn where they are, seen through the plate.
    pockets: pockets.map((p) => ({
      depth: p.depth * METRES_TO_MM,
      back: rear ? !p.back : p.back,
      file: `${p.back ? 'REAR_' : ''}POCKET_${depthName(p.depth)}.dxf`,
      entities: faceLayout(body, { ...p.view, outward: profile.outward }, curves, { origin: face.origin }).entities,
    })),
  };
}

/**
 * One face of a part, as a drawing shows it: its outline, its round holes
 * tagged and grouped by size and thread (as `plateFeatures`), and the size
 * of the part's box, for the stock to cut it from.
 *
 * @param {object} body
 * @param {object} view       As `faceLayout` takes it (a side from `allSides`, or a plate's profile)
 * @param {Map<string, number[][]>} [curves]
 * @param {object[]|null} [holeFaces]  This part's hole faces from `holesByPart`; null: not read
 * @param {object} [analysis]  From `analyzeBody`, for the stock size
 * @returns {object}  `kind: 'face'`, with `side`, `plain` and `stock` (mm, largest first)
 */
export function faceFeatures(body, view, curves, holeFaces = null, analysis = analyzeBody(body)) {
  const layout = faceLayout(body, view, curves);
  const tapped = tappedByEntity(body, holeFaces);
  const infoOf = (h) => tapInfo((h.edges ?? []).map((id) => tapped.get(id)).find(Boolean));

  // One group per size and thread: largest first, a tapped one before a plain one.
  const kinds = [];
  const sameKind = (k, d, info) => Math.abs(k.d - d) < SAME_SIZE * METRES_TO_MM && k.tap === info.tap
    && (k.tapDepth ?? 0) === (info.tapDepth ?? 0);
  const found = layout.holes.map((h) => ({ h, info: infoOf(h) }));
  for (const { h, info } of found) {
    if (!kinds.some((k) => sameKind(k, h.d, info))) kinds.push({ d: h.d, ...info });
  }
  kinds.sort((a, b) => b.d - a.d || Number(!a.tap) - Number(!b.tap));
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `Z${i - 25}`);
  const groupOf = ({ h, info }) => kinds.findIndex((k) => sameKind(k, h.d, info));

  const ordered = [...found].sort((a, b) => groupOf(a) - groupOf(b)
    || Math.round(a.h.y * 100) - Math.round(b.h.y * 100) || a.h.x - b.h.x);
  const counts = new Map();
  const holes = ordered.map((entry) => {
    const g = groupOf(entry);
    const n = (counts.get(g) ?? 0) + 1;
    counts.set(g, n);
    const k = kinds[g];
    return { tag: `${letter(g)}${n}`, x: entry.h.x, y: entry.h.y, d: k.d, tap: k.tap, major: k.major, tapDepth: k.tapDepth };
  });

  return {
    kind: 'face',
    side: view.name ?? null,
    plain: isPlain(layout),
    stock: (analysis?.dimensions ?? []).map((d) => d * METRES_TO_MM),
    width: layout.width,
    height: layout.height,
    origin: layout.origin,
    entities: layout.entities,
    cutouts: layout.cutouts,
    holeData: holeFaces !== null,
    holes,
    groups: kinds.map((k, i) => ({ letter: letter(i), ...k, count: counts.get(i) ?? 0 })),
    pockets: [],
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
    if (last) {
      last.to = Math.max(last.to, item.to);
      last.faces = [...(last.faces ?? []), ...(item.faces ?? [])];
    } else {
      out.push({ ...item });
    }
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
 * @param {object[]|null} [holeFaces]  This part's hole faces from `holesByPart`; null: not read
 * @returns {null|{
 *   kind: 'axle', length: number, holeData: boolean,
 *   stock: { shape: string, acrossFlats: number|null, diameter: number|null },
 *   sections: { from: number, to: number, shape: string, acrossFlats: number|null, diameter: number|null }[],
 *   bores: { end: 'left'|'right'|'through', d: number, depth: number, tap: string|null }[],
 *   crossHoles: { at: number, d: number, tap: string|null }[],
 *   endView: object|null,
 * }}  Millimetres, positions from the left end
 */
export function axleFeatures(body, analysis = analyzeBody(body), holeFaces = null) {
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
        (face.orientation === false ? bores : rounds).push({ ...span(), d, faces: [face.id] });
      } else if (c < SQUARE && face.orientation === false) {
        cross.push({
          at: along(surf.origin), d, axis: axis.map((v) => Math.round(Math.abs(v) * 1e3)).join(),
          from: along(surf.origin), to: along(surf.origin), faces: [face.id],
        });
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
    return { end, d: b.d, depth: b.to - b.from, faces: b.faces };
  });
  const crossList = [];
  for (const h of cross) {
    const same = crossList.find((c) => Math.abs(c.at - h.at) < SAME_AT && Math.abs(c.d - h.d) < SAME_SIZE);
    if (same) same.faces.push(...h.faces);
    else crossList.push({ ...h, faces: [...h.faces] });
  }
  const tapped = tappedByEntity(body, holeFaces);
  const tapOf = (faces) => tapInfo(faces.map((id) => tapped.get(id)).find(Boolean));

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
    holeData: holeFaces !== null,
    bores: boreList.map(({ faces, ...b }) => ({ ...b, d: mmOf(b.d), depth: mmOf(b.depth), ...tapOf(faces) })),
    crossHoles: crossList.sort((a, b) => a.at - b.at)
      .map((h) => ({ at: mmOf(h.at), d: mmOf(h.d), ...tapOf(h.faces) })),
    endView,
  };
}
