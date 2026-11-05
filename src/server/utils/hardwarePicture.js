/**
 * Pictures of hardware (see `hardwareSpec`) drawn by the tool, so a screw, nut, washer, spacer or
 * bearing costs no OnShape call and needs no vendor: what it is comes from its
 * BOM name ("Socket button head cap screw #10-32 x 0.75"), its size from the
 * dimensions OnShape's standard content carries in its configuration (head
 * diameter, head height, length), or else from the name. Drawn with the iso
 * renderer the part pictures use, as a solid turned about its axis (hex heads
 * and nuts as prisms), seen from above so its head and socket show.
 */

import { Iso } from './isoPicture.js';
import { FINISHES } from './hardwareSpec.js';

const STEEL = FINISHES.steel;

const HOLE = [36, 38, 44];

// ---------------------------------------------------------------- the solid

/** A solid as triangles, each with its colour and surface id. */
class Mesh {
  constructor() { this.tris = []; this.next = 1; }
  /** A fresh surface id. */
  surface() { this.next += 1; return this.next; }

  /**
   * A solid of revolution about z: `profile` [[r, z], …] turned round. Each
   * run of segments with no sharp corner between them is one surface, so a
   * dome draws as one and its rim as an edge.
   */
  lathe(profile, color, { steps = 48 } = {}) {
    let id = this.surface();
    for (let i = 0; i + 1 < profile.length; i += 1) {
      const [r0, z0] = profile[i]; const [r1, z1] = profile[i + 1];
      if (i > 0) {
        const [rp, zp] = profile[i - 1];
        const a = Math.atan2(z0 - zp, r0 - rp); const b = Math.atan2(z1 - z0, r1 - r0);
        let turn = Math.abs(b - a); if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn > 0.45) id = this.surface();
      }
      for (let s = 0; s < steps; s += 1) {
        const t0 = (2 * Math.PI * s) / steps; const t1 = (2 * Math.PI * (s + 1)) / steps;
        const p = (r, z, t) => [r * Math.cos(t), r * Math.sin(t), z];
        const tm = (t0 + t1) / 2; const rm = (r0 + r1) / 2;
        // The face's outward normal: the profile's own normal, turned to this angle.
        const nr = z1 - z0; const nz = -(r1 - r0);
        const n = [nr * Math.cos(tm), nr * Math.sin(tm), nz];
        if (rm === 0 && nz === 0) continue;
        this.tris.push({ p: [p(r0, z0, t0), p(r1, z1, t0), p(r1, z1, t1)], n, color, id });
        this.tris.push({ p: [p(r0, z0, t0), p(r1, z1, t1), p(r0, z0, t1)], n, color, id });
      }
    }
  }

  /** A flat polygon (convex, [x, y] at height z), facing up or down. */
  disc(points, z, color, { up = true, id = this.surface() } = {}) {
    const c = points.reduce((m, [x, y]) => [m[0] + x / points.length, m[1] + y / points.length], [0, 0]);
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      this.tris.push({ p: [[c[0], c[1], z], [a[0], a[1], z], [b[0], b[1], z]], n: [0, 0, up ? 1 : -1], color, id });
    }
    return id;
  }

  /** A prism over a convex polygon, from z0 to z1. */
  prism(points, z0, z1, color) {
    this.disc(points, z1, color);
    this.disc(points, z0, color, { up: false });
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      const n = [b[1] - a[1], -(b[0] - a[0]), 0];
      const id = this.surface();
      this.tris.push({ p: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]], n, color, id });
      this.tris.push({ p: [[a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], n, color, id });
    }
  }
}

/** A regular polygon's corners, [x, y]: `across` is across flats (hex) or the circle's diameter. */
function polygon(sides, across, { flats = true, turn = 0 } = {}) {
  const r = flats ? across / 2 / Math.cos(Math.PI / sides) : across / 2;
  return Array.from({ length: sides }, (_, i) => {
    const t = turn + (2 * Math.PI * i) / sides + (flats ? Math.PI / sides : 0);
    return [r * Math.cos(t), r * Math.sin(t)];
  });
}
const circle = (diameter, n = 40) => polygon(n, diameter, { flats: false });

/** The shank of a screw: a rod from z = 0 down to -length, its tip chamfered. */
function shank(mesh, d, length, color, top = 0) {
  const r = d / 2; const c = Math.min(r * 0.25, length * 0.2);
  mesh.lathe([[r, top], [r, top - length + c], [r - c, top - length], [0, top - length]], color);
}

/** A hex socket or a bore, as a dark polygon just above a face at height z. */
function recess(mesh, points, z) {
  mesh.disc(points, z + 1e-4, HOLE);
}

/** The thread's rings, drawn on the shank as lines. */
function threadLines(spec, from, to) {
  if (!['socket', 'button', 'flat', 'pan', 'hexbolt', 'set', 'shoulder'].includes(spec.kind)) return [];
  const pitch = Math.max(spec.d * 0.16, 0.02);
  const out = [];
  for (let z = from - pitch * 1.5; z > to + pitch; z -= pitch) out.push(z);
  return out;
}

/** The hardware as a mesh, axis on z, head (if any) above z = 0. */
function meshOf(spec) {
  const mesh = new Mesh();
  const { kind, d, length, head, headHeight } = spec;
  const color = FINISHES[spec.finish] ?? STEEL;
  const socket = polygon(6, Math.max(d * 0.5, head * 0.32));
  let shankTop = 0;
  switch (kind) {
    case 'socket': {
      const r = head / 2; const ch = headHeight * 0.08;
      mesh.lathe([[0, headHeight], [r - ch, headHeight], [r, headHeight - ch], [r, 0], [d / 2, 0]], color);
      recess(mesh, socket, headHeight);
      shank(mesh, d, length, color);
      break;
    }
    case 'button':
    case 'pan':
    case 'rivet': {
      const r = head / 2; const side = headHeight * (kind === 'pan' ? 0.55 : 0.2);
      const dome = [];
      for (let i = 0; i <= 10; i += 1) {
        const t = (Math.PI / 2) * (i / 10);
        dome.push([r * Math.cos(t), side + (headHeight - side) * Math.sin(t)]);
      }
      mesh.lathe([[d / 2, 0], [r, 0], ...dome], color);
      if (kind !== 'rivet') recess(mesh, socket, headHeight);
      shank(mesh, d, length, color);
      break;
    }
    case 'flat': {
      const r = head / 2; const deep = (r - d / 2) / Math.tan((41 * Math.PI) / 180);
      mesh.lathe([[0, 0], [r, 0], [r, -deep * 0.08], [d / 2, -deep]], color);
      recess(mesh, socket, 0);
      shankTop = -deep;
      shank(mesh, d, Math.max(length - deep, d), color, shankTop);
      break;
    }
    case 'hexbolt': {
      mesh.prism(polygon(6, head), 0, headHeight, color);
      shank(mesh, d, length, color);
      break;
    }
    case 'shoulder': {
      const r = head / 2; const sd = d * 1.25;
      mesh.lathe([[0, headHeight], [r, headHeight], [r, 0], [sd / 2, 0], [sd / 2, -length * 0.65], [d / 2, -length * 0.65]], color);
      recess(mesh, socket, headHeight);
      shank(mesh, d * 0.8, length * 0.35, color, -length * 0.65);
      shankTop = -length * 0.65;
      break;
    }
    case 'set': {
      mesh.lathe([[0, 0], [d / 2, 0], [d / 2, -length]], color);
      mesh.disc(circle(d), -length, color, { up: false });
      recess(mesh, polygon(6, d * 0.5), 0);
      break;
    }
    case 'pin': {
      const c = d * 0.12;
      mesh.lathe([[0, length / 2], [d / 2 - c, length / 2], [d / 2, length / 2 - c], [d / 2, -length / 2 + c], [d / 2 - c, -length / 2], [0, -length / 2]], color);
      break;
    }
    case 'nut':
    case 'locknut': {
      const t = kind === 'locknut' ? length * 0.7 : length;
      mesh.prism(polygon(6, head), 0, t, color);
      if (kind === 'locknut') {
        mesh.lathe([[head * 0.48, t], [head * 0.45, t + length * 0.35], [d / 2, t + length * 0.35]], color);
        recess(mesh, circle(d * 0.95), t + length * 0.35);
      } else {
        recess(mesh, circle(d * 0.95), t);
      }
      break;
    }
    case 'pulley':
    case 'gear':
    case 'sprocket': {
      const T = spec.teeth; const ro = spec.od / 2; const h = spec.length;
      const step = (2 * Math.PI) / T;
      // Tooth depth from the pitch along the rim (gear: 2.25 / DP; HTD: about 0.4 pitch).
      const pitch = (2 * Math.PI * ro) / T;
      const depth = Math.min(ro * 0.25, pitch * ({ gear: 0.72, pulley: 0.4, sprocket: 0.55 }[kind]));
      const ri = ro - depth;
      const shape = kind === 'sprocket' ? [[ri, 0], [ri, 0.3], [ro, 0.5], [ri, 0.7]] : [[ri, 0], [ri, 0.32], [ro, 0.44], [ro, 0.78], [ri, 0.9]];
      const rim = [];
      for (let i = 0; i < T; i += 1) {
        for (const [r, f] of shape) rim.push([r * Math.cos(step * (i + f)), r * Math.sin(step * (i + f))]);
      }
      let top = h;
      if (kind === 'pulley') {
        // Flanges either side keep the belt on.
        const fl = Math.max(h * 0.08, 0.02); const fr = ro * 1.1;
        mesh.lathe([[ri * 0.9, 0], [fr, 0], [fr, fl], [ri * 0.9, fl]], color);
        mesh.prism(rim, fl, fl + h, color);
        mesh.lathe([[ri * 0.9, fl + h], [fr, fl + h], [fr, h + 2 * fl], [ri * 0.9, h + 2 * fl]], color);
        top = h + 2 * fl;
        mesh.disc(circle(ri * 1.8), top, color);
      } else {
        mesh.prism(rim, 0, h, color);
      }
      const ib = Math.min(spec.id / 2, ri * 0.8);
      recess(mesh, spec.hexBore ? polygon(6, ib * 2) : circle(ib * 2), top);
      break;
    }
    case 'shaft': {
      if (spec.hexBore) mesh.prism(polygon(6, d), 0, length, color);
      else mesh.lathe([[0, length], [d / 2, length], [d / 2, 0], [0, 0]], color);
      break;
    }
    default: { // spacer, standoff, bearing, washer, collar, tube: a ring
      const ro = spec.od / 2; const h = spec.length;
      const ri = Math.min(spec.id / 2, ro * 0.85);
      if (kind === 'standoff') mesh.prism(polygon(6, spec.od), 0, h, color);
      else if (kind === 'bearing') {
        const flange = spec.flange ? [[ro * 1.12, h], [ro * 1.12, h * 0.85], [ro, h * 0.85]] : [[ro, h]];
        mesh.lathe([[ri * 1.35, h], ...flange, [ro, 0], [ri * 1.35, 0]], STEEL);
        // The races and the shield between them.
        mesh.lathe([[ri * 1.35, h + 1e-4], [ri * 1.35 + (ro - ri) * 0.18, h + 1e-4]], [210, 214, 220]);
      } else {
        mesh.lathe([[ri, h], [ro, h], [ro, 0], [ri, 0]], color);
      }
      if (kind === 'collar') {
        // The clamp's slot, through the side that faces the viewer (front right).
        const w = (ro - ri) * 0.12;
        const turn = ([x, y]) => [(x + y) * Math.SQRT1_2, (y - x) * Math.SQRT1_2];
        mesh.prism([[ri * 0.98, -w], [ro * 1.01, -w], [ro * 1.01, w], [ri * 0.98, w]].map(turn), -1e-4, h + 1e-4, HOLE);
      }
      const bore = spec.hexBore ? polygon(6, ri * 2) : circle(ri * 2);
      if (kind === 'bearing') {
        mesh.prism(polygon(32, ri * 2.7, { flats: false }), 0, h, [176, 182, 190]);
      }
      recess(mesh, bore, kind === 'bearing' ? h : h);
      break;
    }
  }
  return { mesh, threads: threadLines(spec, shankTop, shankTop - (kind === 'flat' ? Math.max(length - (head / 2 - d / 2) / Math.tan((41 * Math.PI) / 180), d) : length)) };
}

/**
 * The hardware's isometric picture.
 *
 * @param {ReturnType<typeof import('./hardwareSpec.js').hardwareOf>} spec
 * @param {{ width?: number, height?: number }} [options]
 * @returns {Buffer}  PNG
 */
export function hardwarePicture(spec, { width = 400, height = 300 } = {}) {
  const { mesh, threads } = meshOf(spec);
  const points = mesh.tris.flatMap((t) => t.p);
  const iso = new Iso(points, { width, height, margin: Math.round(Math.min(width, height) * 0.1) });
  for (const t of mesh.tris) iso.tri(t.p[0], t.p[1], t.p[2], iso.shade(t.n, t.color), t.id);
  // Thread rings: short arcs across the front of the shank.
  const r = spec.d / 2;
  for (const z of threads) {
    for (let s = 0; s < 32; s += 1) {
      const a0 = (2 * Math.PI * s) / 32; const a1 = (2 * Math.PI * (s + 1)) / 32;
      iso.line([r * 1.001 * Math.cos(a0), r * 1.001 * Math.sin(a0), z], [r * 1.001 * Math.cos(a1), r * 1.001 * Math.sin(a1), z - 0.0001], [110, 114, 122]);
    }
  }
  iso.outline([40, 44, 52], Math.max(1, Math.round(width / 500)));
  return iso.png();
}
