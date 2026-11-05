/**
 * A part's isometric picture, drawn from OnShape's body details (the shape
 * read the tool already makes for DXFs and drawings), so it costs no OnShape
 * call of its own: flat faces filled at their plane's depth, round faces as
 * bands round their axis, every edge drawn where it isn't hidden, shaded by
 * how each face turns to the light. Seen as OnShape's isometric is (from the
 * front, right and top). Chamfers and fillets on round edges (cones, tori)
 * and freeform faces show by their edges only.
 */

import { createCanvas } from '@napi-rs/canvas';
import { edgePoints } from './partGeometry.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// OnShape's isometric: seen from front (-y), right (+x), top (+z).
const EYE = unit([1, -1, 1]);
const V = mul(EYE, -1);                      // looking direction
const R = unit(cross(V, [0, 0, 1]));         // screen right
const U = cross(R, V);                       // screen up
const LIGHT = unit(add(EYE, [0.3, 0.2, 0.6]));

/** The isometric canvas: a z-buffer (and, for `outline`, which surface each pixel shows). */
export class Iso {
  constructor(points, { width = 800, height = 600, margin = 40 } = {}) {
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of points) {
      const x = dot(p, R); const y = dot(p, U);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    this.k = Math.min((width - 2 * margin) / (x1 - x0 || 1), (height - 2 * margin) / (y1 - y0 || 1));
    this.ox = margin + ((width - 2 * margin) - (x1 - x0) * this.k) / 2 - x0 * this.k;
    this.oy = margin + ((height - 2 * margin) + (y1 - y0) * this.k) / 2 + y0 * this.k;
    this.w = width; this.h = height;
    this.z = new Float64Array(width * height).fill(Infinity);
    this.rgb = new Uint8ClampedArray(width * height * 4).fill(255);
    /** Surface id per pixel (-1: background), for triangles drawn with one. */
    this.ids = new Int32Array(width * height).fill(-1);
  }
  /** Screen x, y and depth (smaller is nearer). */
  at(p) { return [this.ox + dot(p, R) * this.k, this.oy - dot(p, U) * this.k, dot(p, V)]; }
  shade(n, color) {
    const m = dot(n, EYE) < 0 ? mul(n, -1) : n;          // two-sided
    const i = 0.38 + 0.62 * Math.max(0, dot(unit(m), LIGHT));
    return color.map((c) => Math.round(c * i));
  }
  /** A filled triangle; `id` names the surface it belongs to, for `outline`. */
  tri(a, b, c, color, id = 0) {
    const [A, B, C] = [this.at(a), this.at(b), this.at(c)];
    const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5; const py = y + 0.5;
        const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
        const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const i = y * this.w + x;
        if (z >= this.z[i]) continue;
        this.z[i] = z;
        this.ids[i] = id;
        this.rgb.set([color[0], color[1], color[2], 255], i * 4);
      }
    }
  }
  /**
   * Edge lines from the picture itself: wherever a pixel and its neighbour
   * show different surfaces (or one shows nothing), so a solid's outline and
   * its creases are drawn without knowing its edges.
   */
  outline(color = [40, 44, 52], width = 1) {
    const { w, h, ids } = this;
    const mark = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if ((x + 1 < w && ids[i] !== ids[i + 1]) || (y + 1 < h && ids[i] !== ids[i + w])) {
          // The line goes on the nearer side's pixel (the one with a surface).
          const j = ids[i] === -1 ? (x + 1 < w && ids[i + 1] !== -1 ? i + 1 : i + w) : i;
          mark[j] = 1;
        }
      }
    }
    const r = Math.max(0, Math.round(width) - 1);
    for (let i = 0; i < w * h; i += 1) {
      if (!mark[i]) continue;
      const x = i % w; const y = (i - x) / w;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const xx = x + dx; const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) this.rgb.set([color[0], color[1], color[2], 255], (yy * w + xx) * 4);
        }
      }
    }
  }
  /** A line, drawn where it isn't behind a surface. */
  line(p, q, color = [40, 44, 52]) {
    const [A, B] = [this.at(p), this.at(q)];
    const steps = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) * 1.5));
    const bias = 0.002 * Math.max(1, 1 / this.k) + 2 / this.k;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = Math.round(A[0] + (B[0] - A[0]) * t); const y = Math.round(A[1] + (B[1] - A[1]) * t);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const z = A[2] + (B[2] - A[2]) * t;
      const i = y * this.w + x;
      if (z > this.z[i] + bias) continue;
      this.rgb.set([color[0], color[1], color[2], 255], i * 4);
    }
  }
  png() {
    const canvas = createCanvas(this.w, this.h);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.rgb);
    ctx.putImageData(img, 0, 0);
    return canvas.toBuffer('image/png');
  }
}

/** The colour a part is drawn in when the BOM gives none: a steel blue-grey. */
export const DEFAULT_COLOR = [150, 160, 178];

/** The darkest a part is drawn (0-255 lightness), so a black part's shading and edges still show. */
const MIN_LIGHTNESS = 78;

/** A colour as the BOM gives it ({ red, green, blue }), or the default; a very dark one lifted to charcoal. */
export function colorFrom(appearance) {
  const c = appearance?.color ?? appearance;
  if (!c || ![c.red, c.green, c.blue].every(Number.isFinite)) return DEFAULT_COLOR;
  const rgb = [c.red, c.green, c.blue];
  const light = Math.max(...rgb);
  if (light >= MIN_LIGHTNESS) return rgb;
  // Keep the hue, raise the lightness.
  return rgb.map((v) => Math.round(MIN_LIGHTNESS - light + v));
}

// ------------------------------------------------------------ from the shape read

/** A loop's points in order, its edges joined end to end. */
function loopPoints(loop, edges) {
  const runs = loop.coedges.map(({ edgeId }) => edgePoints(edges.get(edgeId) ?? {}) ?? []).filter((r) => r.length);
  if (!runs.length) return [];
  const close = (p, q) => Math.hypot(...sub(p, q)) < 1e-6;
  const out = [...runs.shift()];
  while (runs.length) {
    const end = out[out.length - 1];
    let i = runs.findIndex((r) => close(r[0], end));
    if (i >= 0) { out.push(...runs.splice(i, 1)[0].slice(1)); continue; }
    i = runs.findIndex((r) => close(r[r.length - 1], end));
    if (i >= 0) { out.push(...runs.splice(i, 1)[0].reverse().slice(1)); continue; }
    out.push(...runs.shift()); // not joined: carry on
  }
  return out;
}

/** Fill a flat face (its loops, even-odd) at the depth of its plane. */
function fillPlane(iso, face, edges, color) {
  const n = unit(face.surface.normal);
  const nv = dot(n, V);
  if (Math.abs(nv) < 1e-3) return;          // seen edge-on
  const c = dot(n, face.surface.origin);
  const polys = face.loops.map((l) => loopPoints(l, edges).map((p) => iso.at(p))).filter((p) => p.length > 2);
  if (!polys.length) return;
  let yLo = Infinity; let yHi = -Infinity;
  for (const p of polys.flat()) { if (p[1] < yLo) yLo = p[1]; if (p[1] > yHi) yHi = p[1]; }
  const shade = iso.shade(n, color);
  for (let y = Math.max(0, Math.floor(yLo)); y <= Math.min(iso.h - 1, Math.ceil(yHi)); y += 1) {
    const py = y + 0.5;
    const xs = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i += 1) {
        const a = poly[i]; const b = poly[(i + 1) % poly.length];
        if ((a[1] <= py) !== (b[1] <= py)) xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      for (let x = Math.max(0, Math.ceil(xs[j] - 0.5)); x <= Math.min(iso.w - 1, Math.floor(xs[j + 1] - 0.5)); x += 1) {
        // The plane's point under this pixel: o + sx R + sy U + t V, with n.p = c.
        const sx = (x + 0.5 - iso.ox) / iso.k; const sy = (iso.oy - py) / iso.k;
        const p0 = add(mul(R, sx), mul(U, sy));
        const t = (c - dot(n, p0)) / nv;
        const i = y * iso.w + x;
        if (t >= iso.z[i]) continue;
        iso.z[i] = t;
        iso.rgb.set([shade[0], shade[1], shade[2], 255], i * 4);
      }
    }
  }
}

/** A round face as a band of quads round its axis, over the angle and length its edges span. */
function fillCylinder(iso, face, edges, color) {
  const { origin, axis, radius } = face.surface;
  const A = unit(axis);
  const e1 = unit(cross(A, Math.abs(A[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const e2 = cross(A, e1);
  const pts = face.loops.flatMap((l) => loopPoints(l, edges));
  if (!pts.length) return;
  const ts = pts.map((p) => dot(sub(p, origin), A));
  const angles = pts.map((p) => { const d = sub(p, origin); return Math.atan2(dot(d, e2), dot(d, e1)); }).sort((a, b) => a - b);
  // The angle range: all the way round, or the arc its points cover (the largest gap left out).
  const full = face.loops.some((l) => l.coedges.some(({ edgeId }) => {
    const e = edges.get(edgeId); return e?.curve?.type === 'circle' && (e.geometry?.arcSweep ?? 2 * Math.PI) > 2 * Math.PI - 1e-3;
  }));
  let from = -Math.PI; let to = Math.PI;
  if (!full) {
    let gap = 0; let at = 0;
    for (let i = 0; i < angles.length; i += 1) {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
      if (next - angles[i] > gap) { gap = next - angles[i]; at = i; }
    }
    from = angles[(at + 1) % angles.length]; to = from + (2 * Math.PI - gap);
  }
  const t0 = ts.reduce((m, v) => Math.min(m, v), Infinity); const t1 = ts.reduce((m, v) => Math.max(m, v), -Infinity);
  const steps = Math.max(4, Math.ceil(((to - from) / (2 * Math.PI)) * 64));
  const point = (a, t) => add(add(origin, mul(A, t)), add(mul(e1, radius * Math.cos(a)), mul(e2, radius * Math.sin(a))));
  for (let s = 0; s < steps; s += 1) {
    const a0 = from + ((to - from) * s) / steps; const a1 = from + ((to - from) * (s + 1)) / steps;
    const am = (a0 + a1) / 2;
    const n = add(mul(e1, Math.cos(am)), mul(e2, Math.sin(am)));
    const shade = iso.shade(n, color);
    const [p, q, r, u] = [point(a0, t0), point(a1, t0), point(a1, t1), point(a0, t1)];
    iso.tri(p, q, r, shade); iso.tri(p, r, u, shade);
  }
}

/**
 * @param {object} body  One body from OnShape's body details
 * @param {{ color?: number[], width?: number, height?: number }} [options]
 * @returns {Buffer}  PNG
 */
export function isoPicture(body, { color = DEFAULT_COLOR, width = 800, height = 600 } = {}) {
  const opts = { width, height };
  const edges = new Map((body.edges ?? []).map((e) => [e.id, e]));
  const pts = (body.edges ?? []).flatMap((e) => edgePoints(e));
  const iso = new Iso(pts, opts);
  for (const face of body.faces ?? []) {
    if (face.surface?.type === 'plane') fillPlane(iso, face, edges, color);
    else if (face.surface?.type === 'cylinder') fillCylinder(iso, face, edges, color);
  }
  for (const e of body.edges ?? []) {
    const p = edgePoints(e);
    for (let i = 1; i < p.length; i += 1) iso.line(p[i - 1], p[i]);
  }
  return iso.png();
}
