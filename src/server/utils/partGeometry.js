/**
 * A part's size and flat outline, worked out from OnShape's body details
 * (faces, edges, vertices; lengths in metres).
 *
 * The part's three dimensions are the sides of its tightest box, found by
 * trying the frame of each of its largest flat faces. The smallest side is
 * the thickness, and "the side" a flat part is cut from is the flat face
 * square to it: the one whose two dimensions are the part's two largest.
 */

import { THICKNESS } from './bomConstants.js';

const ARC_STEPS = 24;
const FULL_TURN = 2 * Math.PI;
const METRES_PER_INCH = 0.0254;

/** How far (inches) a part's thickness may sit from a stock thickness and still count as it. */
export const THICKNESS_TOLERANCE_IN = 0.01;

/** Extents this close (relative) are a tie; the face normal wins the tie for "smallest". */
const TIE = 1e-3;

// ---------------------------------------------------------------- vectors

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = length(a);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Some unit vector square to `n`. */
function anyPerpendicular(n) {
  const axis = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, axis));
}

// ---------------------------------------------------------------- edges

/** Points along an arc or circle edge, in the direction the edge runs. */
function arcPoints(edge, steps = ARC_STEPS) {
  const { origin, normal, radius } = edge.curve;
  const g = edge.geometry;
  const c = unit(normal);
  const a = unit(sub(g.startPoint, origin));
  let b = cross(c, a);
  // Run the way the edge runs: its tangent at the start decides.
  if (g.startVector && dot(b, g.startVector) < 0) b = scale(b, -1);
  const sweep = g.arcSweep ?? FULL_TURN;
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = (sweep * i) / steps;
    points.push(add(origin, add(scale(a, radius * Math.cos(t)), scale(b, radius * Math.sin(t)))));
  }
  return points;
}

/** The points that bound an edge: its ends, plus samples along a curve. */
function edgePoints(edge) {
  const g = edge.geometry ?? {};
  if (edge.curve?.type === 'line') return [g.startPoint, g.endPoint].filter(Boolean);
  if (edge.curve?.type === 'circle' && g.startPoint) return arcPoints(edge);
  return [g.startPoint, g.quarterPoint, g.midPoint, g.endPoint].filter(Boolean);
}

function bodyPoints(body) {
  const points = (body.vertices ?? []).map((v) => v.point);
  for (const edge of body.edges ?? []) points.push(...edgePoints(edge));
  return points;
}

function extentAlong(points, direction) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = dot(p, direction);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max, size: max - min };
}

// ---------------------------------------------------------------- dimensions

/** A frame (n, u, v) from a flat face: u along its longest straight edge. */
function frameOfFace(face, edgesById) {
  const n = unit(face.surface.normal);
  let best = null;
  for (const coedge of face.loops?.[0]?.coedges ?? []) {
    const edge = edgesById.get(coedge.edgeId);
    if (edge?.curve?.type !== 'line') continue;
    const len = edge.geometry.length ?? length(sub(edge.geometry.endPoint, edge.geometry.startPoint));
    if (!best || len > best.len) best = { len, edge };
  }
  const u = best
    ? unit(sub(best.edge.geometry.endPoint, best.edge.geometry.startPoint))
    : anyPerpendicular(n);
  return { n, u, v: unit(cross(n, u)) };
}

/**
 * @param {object} body  One body from OnShape's body details
 * @returns {{
 *   dimensions: number[], axes: { vec: number[], size: number, min: number, max: number }[],
 *   thicknessAxis: number[], thickness: number,
 *   longAxis: number[], face: object, outward: number[],
 * }|null}  Dimensions largest first, in metres; null for a body with no flat face
 */
export function analyzeBody(body) {
  const planar = (body.faces ?? [])
    .filter((f) => f.surface?.type === 'plane' && f.area > 0)
    .sort((a, b) => b.area - a.area);
  if (planar.length === 0) return null;

  const edgesById = new Map((body.edges ?? []).map((e) => [e.id, e]));
  const points = bodyPoints(body);

  // Try the frame of each of the largest faces that face a different way.
  const tried = [];
  for (const face of planar) {
    const n = unit(face.surface.normal);
    if (tried.some((t) => Math.abs(dot(t, n)) > 0.999)) continue;
    tried.push(n);
    if (tried.length === 3) break;
  }
  let best = null;
  for (const n of tried) {
    const face = planar.find((f) => Math.abs(dot(unit(f.surface.normal), n)) > 0.999);
    const frame = frameOfFace(face, edgesById);
    const axes = [
      { vec: frame.n, role: 'n' },
      { vec: frame.u, role: 'u' },
      { vec: frame.v, role: 'v' },
    ].map((axis) => ({ ...axis, ...extentAlong(points, axis.vec) }));
    const volume = axes.reduce((v, a) => v * a.size, 1);
    if (!best || volume < best.volume) best = { volume, axes };
  }

  // Largest first. Within a tie the face normal counts as the smallest and
  // the long edge as the largest.
  const rank = { u: 0, v: 1, n: 2 };
  const axes = [...best.axes].sort((a, b) => {
    const scaleOf = Math.max(a.size, b.size);
    if (Math.abs(a.size - b.size) <= TIE * scaleOf) return rank[a.role] - rank[b.role];
    return b.size - a.size;
  });
  const thin = axes[2];

  const side = planar.find((f) => Math.abs(dot(unit(f.surface.normal), thin.vec)) > 0.999);
  if (!side) return null;
  // The face's outward direction along the thin axis: away from the part's middle.
  const faceAt = dot(side.surface.origin, thin.vec);
  const outward = faceAt > (thin.min + thin.max) / 2 ? thin.vec : scale(thin.vec, -1);

  return {
    dimensions: axes.map((a) => a.size),
    axes: axes.map(({ vec, size, min, max }) => ({ vec, size, min, max })),
    thicknessAxis: thin.vec,
    thickness: thin.size,
    longAxis: axes[0].vec,
    face: side,
    outward,
  };
}

/** OnShape's standard views, and the direction each is looked at from. */
const NAMED_SIDES = [
  { name: 'TOP', direction: [0, 0, 1] },
  { name: 'RIGHT', direction: [1, 0, 0] },
  { name: 'FRONT', direction: [0, -1, 0] },
];
const ASSIGNMENTS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * The part seen from each of OnShape's named sides (TOP, RIGHT, FRONT): for
 * each, the flat face on that side of the part's box (the largest one), to
 * draw as seen from outside. Each side of the part's box is matched to the
 * named side it faces most closely, so a part tilted in its Part Studio still
 * gets one view of each side. A side with no flat face is left out.
 *
 * @param {object} body
 * @param {object} analysis  From `analyzeBody`
 * @returns {{ name: string, face: object, outward: number[], longAxis: number[] }[]}
 */
export function sideViews(body, analysis) {
  const planar = (body.faces ?? []).filter((f) => f.surface?.type === 'plane' && f.area > 0);
  const facing = (axis, named) => Math.abs(dot(axis.vec, named.direction));
  const best = ASSIGNMENTS.reduce((winner, order) => {
    const score = order.reduce((sum, axisIndex, i) => sum + facing(analysis.axes[axisIndex], NAMED_SIDES[i]), 0);
    return !winner || score > winner.score ? { order, score } : winner;
  }, null);

  const views = [];
  best.order.forEach((axisIndex, i) => {
    const axis = analysis.axes[axisIndex];
    const named = NAMED_SIDES[i];
    const sign = dot(axis.vec, named.direction) >= 0 ? 1 : -1;
    const middle = (axis.min + axis.max) / 2;
    const parallel = planar.filter((f) => Math.abs(dot(unit(f.surface.normal), axis.vec)) > 0.999);
    if (parallel.length === 0) return;
    // The face on the named side (the part's near side for that view), else the other.
    const side = (f) => (dot(f.surface.origin, axis.vec) > middle ? 1 : -1);
    const wanted = parallel.filter((f) => side(f) === sign);
    const pool = wanted.length ? wanted : parallel;
    const face = pool.reduce((a, b) => (b.area > a.area ? b : a));
    const inPlane = analysis.axes.filter((_, index) => index !== axisIndex);
    views.push({
      name: named.name,
      face,
      outward: scale(axis.vec, side(face)),
      longAxis: inPlane.reduce((a, b) => (b.size > a.size ? b : a)).vec,
    });
  });
  return views;
}

/**
 * The Thickness option a part's smallest dimension matches, or null.
 * @param {number} metres
 * @returns {string|null}  e.g. "0.125"
 */
export function thicknessOption(metres) {
  const inches = metres / METRES_PER_INCH;
  let best = null;
  for (const option of THICKNESS) {
    const stock = Number(option);
    if (!Number.isFinite(stock)) continue;
    const gap = Math.abs(inches - stock);
    if (gap <= THICKNESS_TOLERANCE_IN && (!best || gap < best.gap)) best = { option, gap };
  }
  return best?.option ?? null;
}

// ---------------------------------------------------------------- DXF

/** Edges of a body's chosen face that need more than their end points to draw. */
export function curvedEdgeIds(body, analysis) {
  const edgesById = new Map((body.edges ?? []).map((e) => [e.id, e]));
  const ids = new Set();
  for (const loop of analysis.face.loops ?? []) {
    for (const { edgeId } of loop.coedges) {
      const type = edgesById.get(edgeId)?.curve?.type;
      if (type && type !== 'line' && type !== 'circle') ids.add(edgeId);
    }
  }
  return [...ids];
}

const mm = (metres) => metres * 1000;
const degrees = (radians) => (radians * 180) / Math.PI;
const mod360 = (d) => ((d % 360) + 360) % 360;

/**
 * The outline of the part's chosen face as a DXF (millimetres, one layer):
 * lines, arcs and circles, with other curves as short lines. Seen from
 * outside the part, lower left at the origin.
 *
 * @param {object} body
 * @param {object} analysis                 From `analyzeBody`
 * @param {Map<string, number[][]>} [curves]  Points along edges that are neither lines nor circles
 * @returns {string}
 */
export function dxfOfFace(body, analysis, curves = new Map()) {
  const edgesById = new Map((body.edges ?? []).map((e) => [e.id, e]));
  const ex = analysis.longAxis;
  const ey = unit(cross(analysis.outward, ex));
  const project = (p) => [mm(dot(p, ex)), mm(dot(p, ey))];

  const seen = new Set();
  const edges = [];
  for (const loop of analysis.face.loops ?? []) {
    for (const { edgeId } of loop.coedges) {
      if (seen.has(edgeId) || !edgesById.has(edgeId)) continue;
      seen.add(edgeId);
      edges.push(edgesById.get(edgeId));
    }
  }

  // Lower left of the outline at the origin.
  const outline = edges.flatMap((e) => (curves.get(e.id) ?? edgePoints(e)).map(project));
  const x0 = Math.min(...outline.map((p) => p[0]));
  const y0 = Math.min(...outline.map((p) => p[1]));
  const at = (p) => { const q = project(p); return [q[0] - x0, q[1] - y0]; };

  const entities = [];
  const line = (a, b) => entities.push(['LINE', a, b]);
  for (const edge of edges) {
    const g = edge.geometry ?? {};
    const type = edge.curve?.type;
    if (type === 'line') {
      line(at(g.startPoint), at(g.endPoint));
    } else if (type === 'circle') {
      const center = at(edge.curve.origin);
      const r = mm(edge.curve.radius);
      const full = (g.arcSweep ?? FULL_TURN) >= FULL_TURN - 1e-6;
      if (full) {
        entities.push(['CIRCLE', center, r]);
      } else {
        const angle = (p) => mod360(degrees(Math.atan2(p[1] - center[1], p[0] - center[0])));
        const start = angle(at(g.startPoint));
        const end = angle(at(g.endPoint));
        const middle = angle(at(g.midPoint));
        // An ARC runs counter-clockwise from its start to its end.
        const through = mod360(middle - start) <= mod360(end - start);
        entities.push(['ARC', center, r, through ? start : end, through ? end : start]);
      }
    } else {
      const points = (curves.get(edge.id) ?? edgePoints(edge)).map(at);
      for (let i = 1; i < points.length; i += 1) line(points[i - 1], points[i]);
    }
  }
  return writeDxf(entities);
}

const num = (n) => (Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(4)));

function writeDxf(entities) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES'];
  for (const [kind, ...args] of entities) {
    out.push('0', kind, '8', '0');
    if (kind === 'LINE') {
      const [a, b] = args;
      out.push('10', num(a[0]), '20', num(a[1]), '30', 0, '11', num(b[0]), '21', num(b[1]), '31', 0);
    } else if (kind === 'CIRCLE') {
      const [c, r] = args;
      out.push('10', num(c[0]), '20', num(c[1]), '30', 0, '40', num(r));
    } else {
      const [c, r, start, end] = args;
      out.push('10', num(c[0]), '20', num(c[1]), '30', 0, '40', num(r), '50', num(start), '51', num(end));
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return `${out.join('\r\n')}\r\n`;
}
