/**
 * Which views of a part get a DXF and a drawing.
 *
 * - A plate (a Part with a Thickness): its through cuts and pockets as one
 *   view (one drawing, a DXF per pocket depth, see `plateViews`), plus each
 *   edge that has features of its own (a hole drilled into the edge).
 * - An axle: its axle drawing, plus any flat with features of its own.
 * - Anything else (a tube, a block): its TOP, RIGHT and FRONT sides, and an
 *   opposite side (BOTTOM, LEFT, BACK) too when it doesn't show the same
 *   features (a blind hole, a pocket from that side).
 *
 * Every view gets a drawing. A plain face, just a rectangle with no holes,
 * cutouts or notches, gets no DXF (there is nothing to cut), but still a
 * drawing, so students know the size of stock to get.
 */

import { allSides, faceLayout, OPPOSITE } from './partGeometry.js';

/** Positions and sizes closer than this (mm) are the same feature. */
const SAME_MM = 0.02;

/** True when a face is only its outline: four straight sides and nothing inside. */
export function isPlain(layout) {
  return layout.holes.length === 0 && layout.cutouts === 0
    && layout.entities.length === 4 && layout.entities.every(([kind]) => kind === 'LINE');
}

const close = (a, b) => Math.abs(a - b) < SAME_MM;

/** The features of a layout, to compare: round holes, and every other edge's ends. */
function signature(layout) {
  const holes = layout.holes.map((h) => [h.x, h.y, h.d]);
  const others = layout.entities
    .filter(([kind, center, r]) => !(kind === 'CIRCLE' && layout.holes.some((h) => close(h.x, center[0]) && close(h.y, center[1]) && close(h.d, r * 2))))
    .map(([kind, a, b]) => (kind === 'LINE' ? [a[0], a[1], b[0], b[1]] : [a[0], a[1], b]));
  return { holes, others, width: layout.width, height: layout.height };
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  const left = [...b];
  for (const item of a) {
    const i = left.findIndex((o) => o.length === item.length && o.every((v, j) => close(v, item[j])));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/**
 * True when the far side of a part shows the same features as the near
 * side, both seen from the near side (as if through the part) with one 0,0.
 */
export function sameFeatures(body, near, far, curves) {
  const a = faceLayout(body, near, curves);
  const b = faceLayout(body, { ...far, outward: near.outward }, curves, { origin: a.origin });
  const sa = signature(a);
  const sb = signature(b);
  return close(sa.width, sb.width) && close(sa.height, sb.height)
    && sameList(sa.holes, sb.holes) && sameList(sa.others, sb.others);
}

/**
 * A plate's rear side, when it shows more than the through cuts (pockets,
 * counterbores or countersinks cut from the back): its face seen from the
 * back. Null when the rear is just the through cuts, as the profile shows.
 *
 * @param {object} profile  The plate's profile view (`plateViews`)
 * @returns {object|null}  A view as `faceLayout` takes it, named REAR
 */
export function plateRearView(body, analysis, profile, curves) {
  const up = profile.outward;
  const at = (f) => f.surface.origin.reduce((sum, v, i) => sum + v * up[i], 0);
  const square = (body.faces ?? []).filter((f) => f.surface?.type === 'plane' && f.area > 0
    && Math.abs(f.surface.normal.reduce((sum, v, i) => sum + v * up[i], 0)) > 0.999);
  if (square.length === 0) return null;
  const low = Math.min(...square.map(at));
  const rear = square.filter((f) => at(f) - low < 1e-5).reduce((a, b) => (b.area > a.area ? b : a));
  const view = { name: 'REAR', face: rear, outward: up.map((v) => -v), longAxis: profile.longAxis };
  return sameFeatures(body, profile, view, curves) ? null : view;
}

/** An axle's length direction: the long side of its box. */
function axleAxis(analysis) {
  return analysis.axes[0].vec;
}

/**
 * @param {object} body
 * @param {object} analysis  From `analyzeBody`
 * @param {{ plate: boolean, axle: boolean, curves?: Map }} kind
 * @returns {{ name: string, view: object, plain: boolean, dxf: boolean }[]}  Side views, in the order to show them
 */
export function sideViewPlan(body, analysis, { plate, axle, curves }) {
  const sides = allSides(body, analysis);
  const byName = new Map(sides.map((s) => [s.name, s]));
  const entry = (side) => {
    const layout = faceLayout(body, side, curves);
    const plain = isPlain(layout);
    return { name: side.name, view: side, plain, dxf: !plain, inside: layout.holes.length + layout.cutouts > 0 };
  };

  if (plate || axle) {
    // Only sides with features of their own: the main drawing covers the
    // rest, a plate's two faces and an axle's two ends included.
    const skip = plate ? analysis.thicknessAxis : axleAxis(analysis);
    const along = (v) => Math.abs(v.reduce((sum, x, i) => sum + x * skip[i], 0));
    // An edge's outline is just the stock's: only holes or cutouts in it count.
    return sides.filter((s) => along(s.outward) < 0.999).map(entry).filter((e) => e.inside);
  }

  const plan = [];
  for (const named of ['TOP', 'RIGHT', 'FRONT']) {
    const near = byName.get(named) ?? byName.get(OPPOSITE[named]);
    if (!near) continue;
    plan.push(entry(near));
    const farName = near.name === named ? OPPOSITE[named] : named;
    const far = byName.get(farName);
    if (!far) continue;
    const farEntry = entry(far);
    // Both plain: nothing on either side to miss.
    if (plan[plan.length - 1].plain && farEntry.plain) continue;
    if (!sameFeatures(body, near, far, curves)) plan.push(farEntry);
  }
  return plan;
}
