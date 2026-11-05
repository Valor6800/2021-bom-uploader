/** A made-up axle in OnShape's body-details shape (metres), for tests. */


const circleEdge = (id, origin, normal, radius) => {
  const n = normal;
  // A start point square to the normal.
  const a = Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [-n[1], n[0], 0];
  const l = Math.hypot(...a);
  const u = a.map((v) => v / l);
  const start = origin.map((v, i) => v + u[i] * radius);
  const mid = origin.map((v, i) => v - u[i] * radius);
  const cross = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return {
    id,
    geometry: { startPoint: start, endPoint: start, midPoint: mid, startVector: cross, arcSweep: 2 * Math.PI },
    curve: { type: 'circle', origin, normal, radius },
  };
};
const loop = (type, ...ids) => ({ type, coedges: ids.map((edgeId) => ({ edgeId })) });

/**
 * A round axle along z: lengths of it at sizes, bores, holes across (along x).
 * @param {{ L: number, lengths: { from: number, to: number, d: number }[],
 *   bores?: { from: number, to: number, d: number }[], cross?: { at: number, d: number }[] }} spec
 */
export function roundAxle({ L, lengths, bores = [], cross = [] }) {
  const edges = [];
  const faces = [];
  const ring = (id, z, d) => { edges.push(circleEdge(id, [0, 0, z], [0, 0, 1], d / 2)); return id; };
  lengths.forEach((s, i) => {
    const a = ring(`o${i}a`, s.from, s.d);
    const b = ring(`o${i}b`, s.to, s.d);
    faces.push({
      id: `cyl${i}`, orientation: true, area: Math.PI * s.d * (s.to - s.from),
      surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: s.d / 2 },
      loops: [loop('other', a), loop('other', b)],
    });
  });
  bores.forEach((s, i) => {
    const a = ring(`b${i}a`, s.from, s.d);
    const b = ring(`b${i}b`, s.to, s.d);
    faces.push({
      id: `bore${i}`, orientation: false, area: Math.PI * s.d * (s.to - s.from),
      surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: s.d / 2 },
      loops: [loop('other', a), loop('other', b)],
    });
  });
  cross.forEach((h, i) => {
    const R = lengths[0].d / 2;
    edges.push(circleEdge(`x${i}a`, [R, 0, h.at], [1, 0, 0], h.d / 2), circleEdge(`x${i}b`, [-R, 0, h.at], [1, 0, 0], h.d / 2));
    faces.push({
      id: `cross${i}`, orientation: false, area: Math.PI * h.d * 2 * R,
      surface: { type: 'cylinder', origin: [0, 0, h.at], axis: [1, 0, 0], radius: h.d / 2 },
      loops: [loop('other', `x${i}a`), loop('other', `x${i}b`)],
    });
  });
  // The two ends.
  const d0 = lengths[0].d;
  const dn = lengths[lengths.length - 1].d;
  faces.push({
    id: 'left', orientation: true, area: Math.PI * (d0 / 2) ** 2,
    surface: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, -1] }, loops: [loop('outer', 'o0a')],
  });
  faces.push({
    id: 'right', orientation: true, area: Math.PI * (dn / 2) ** 2,
    surface: { type: 'plane', origin: [0, 0, L], normal: [0, 0, 1] }, loops: [loop('outer', `o${lengths.length - 1}b`)],
  });
  return { id: 'AX', faces, edges, vertices: [] };
}
