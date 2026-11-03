import {
  analyzeBody, curvedEdgeIds, dxfOfFace, sideViews, thicknessOption,
} from '../../src/server/utils/partGeometry.js';

// ---------------------------------------------------------------- a plate, in OnShape's body-details shape (metres)

const line = (id, a, b) => ({
  id,
  geometry: {
    startPoint: a,
    endPoint: b,
    midPoint: a.map((v, i) => (v + b[i]) / 2),
    length: Math.hypot(...a.map((v, i) => b[i] - v)),
  },
  curve: { type: 'line' },
});

const circle = (id, origin, normal, radius, over = {}) => ({
  id,
  geometry: {
    startPoint: [origin[0] + radius, origin[1], origin[2]],
    endPoint: [origin[0] + radius, origin[1], origin[2]],
    midPoint: [origin[0] - radius, origin[1], origin[2]],
    startVector: [0, 1, 0],
    arcSweep: 2 * Math.PI,
    ...over,
  },
  curve: { type: 'circle', origin, normal, radius },
});

/** A w x h x t plate: z from 0 to t, a hole through the middle, optionally one rounded corner. */
function plate({ w = 0.1, h = 0.05, t = 0.003175, hole = true, corner = false, topOnlyHole = false } = {}) {
  const r = 0.01;
  const edges = [];
  const outline = (z, tag) => {
    const ids = [];
    const add = (e) => { edges.push(e); ids.push(e.id); };
    if (!corner) {
      add(line(`${tag}b`, [0, 0, z], [w, 0, z]));
      add(line(`${tag}r`, [w, 0, z], [w, h, z]));
      add(line(`${tag}t`, [w, h, z], [0, h, z]));
    } else {
      add(line(`${tag}b`, [0, 0, z], [w, 0, z]));
      add(line(`${tag}r`, [w, 0, z], [w, h - r, z]));
      add({
        id: `${tag}c`,
        geometry: {
          startPoint: [w, h - r, z],
          endPoint: [w - r, h, z],
          midPoint: [w - r + r * Math.SQRT1_2, h - r + r * Math.SQRT1_2, z],
          startVector: [0, 1, 0],
          arcSweep: Math.PI / 2,
        },
        curve: { type: 'circle', origin: [w - r, h - r, z], normal: [0, 0, 1], radius: r },
      });
      add(line(`${tag}t`, [w - r, h, z], [0, h, z]));
    }
    add(line(`${tag}l`, [0, h, z], [0, 0, z]));
    return ids;
  };
  const topIds = outline(t, 'T');
  const botIds = outline(0, 'B');
  const holeEdge = (z, tag) => circle(`${tag}hole`, [w / 2, h / 2, z], [0, 0, 1], 0.005);
  const faces = [];
  const area = w * h - (hole ? Math.PI * 0.005 ** 2 : 0);
  const loops = (ids, withHole, tag) => [
    { type: 'outer', coedges: ids.map((edgeId) => ({ edgeId })) },
    ...(withHole ? [{ type: 'inner', coedges: [{ edgeId: `${tag}hole` }] }] : []),
  ];
  if (hole) edges.push(holeEdge(t, 'T'));
  if (hole && !topOnlyHole) edges.push(holeEdge(0, 'B'));
  faces.push({ id: 'top', area, surface: { type: 'plane', origin: [0, 0, t], normal: [0, 0, 1] }, loops: loops(topIds, hole, 'T') });
  faces.push({
    id: 'bottom',
    area: area + (topOnlyHole ? Math.PI * 0.005 ** 2 : 0),
    surface: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, -1] },
    loops: loops(botIds, hole && !topOnlyHole, 'B'),
  });
  faces.push({ id: 'front', area: w * t, surface: { type: 'plane', origin: [0, 0, 0], normal: [0, -1, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'Bb' }] }] });
  faces.push({ id: 'right', area: h * t, surface: { type: 'plane', origin: [w, 0, 0], normal: [1, 0, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'Br' }] }] });
  faces.push({ id: 'back', area: w * t, surface: { type: 'plane', origin: [0, h, 0], normal: [0, 1, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'Bt' }] }] });
  faces.push({ id: 'left', area: h * t, surface: { type: 'plane', origin: [0, 0, 0], normal: [-1, 0, 0] }, loops: [{ type: 'outer', coedges: [{ edgeId: 'Bl' }] }] });
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].flatMap(([x, y], i) => [
    { id: `vt${i}`, point: [x, y, t] }, { id: `vb${i}`, point: [x, y, 0] },
  ]);
  return { id: 'JVD', type: 'solid', faces, edges, vertices: corners };
}

/** Turn and move a body, as if the part sat tilted somewhere else in its Part Studio. */
function moved(body, { angle = 0.6, offset = [0.3, -0.2, 0.1] } = {}) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Rotate about the axis (1, 1, 0) / sqrt(2).
  const k = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const rot = (v) => {
    const kv = k[1] * v[2] - k[2] * v[1];
    const kv1 = k[2] * v[0] - k[0] * v[2];
    const kv2 = k[0] * v[1] - k[1] * v[0];
    const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    return [
      v[0] * c + kv * s + k[0] * d * (1 - c),
      v[1] * c + kv1 * s + k[1] * d * (1 - c),
      v[2] * c + kv2 * s + k[2] * d * (1 - c),
    ];
  };
  const place = (p) => rot(p).map((x, i) => x + offset[i]);
  const g = (e) => Object.fromEntries(Object.entries(e.geometry).map(([key, val]) => [
    key, Array.isArray(val) ? (/Vector/.test(key) ? rot(val) : place(val)) : val,
  ]));
  return {
    ...body,
    vertices: body.vertices.map((v) => ({ ...v, point: place(v.point) })),
    edges: body.edges.map((e) => ({
      ...e,
      geometry: g(e),
      curve: e.curve.origin ? { ...e.curve, origin: place(e.curve.origin), normal: rot(e.curve.normal) } : e.curve,
    })),
    faces: body.faces.map((f) => ({ ...f, surface: { ...f.surface, origin: place(f.surface.origin), normal: rot(f.surface.normal) } })),
  };
}

// ---------------------------------------------------------------- reading a DXF back

function readDxf(text) {
  const t = text.split(/\r?\n/);
  const entities = [];
  let cur = null;
  for (let i = 0; i < t.length - 1; i += 2) {
    const code = t[i].trim();
    const value = t[i + 1];
    if (code === '0') {
      if (cur) entities.push(cur);
      cur = ['LINE', 'ARC', 'CIRCLE'].includes(value) ? { kind: value } : null;
    } else if (cur) {
      cur[code] = Number(value);
    }
  }
  if (cur) entities.push(cur);
  return entities;
}
const count = (entities, kind) => entities.filter((e) => e.kind === kind).length;

// ---------------------------------------------------------------- tests

describe('analyzeBody', () => {
  it('reads a plate as its three sides, thinnest last', () => {
    const a = analyzeBody(plate());
    expect(a.dimensions.map((d) => Number((d * 1000).toFixed(3)))).toEqual([100, 50, 3.175]);
    expect(a.thickness * 1000).toBeCloseTo(3.175, 3);
  });

  it('gets the same sides however the part sits in its Part Studio', () => {
    const a = analyzeBody(moved(plate()));
    expect(a.dimensions.map((d) => Number((d * 1000).toFixed(3)))).toEqual([100, 50, 3.175]);
  });

  it('picks the flat face square to the smallest side, with a hole in it still counting as the big face', () => {
    const a = analyzeBody(plate());
    expect(['top', 'bottom']).toContain(a.face.id);
    expect(Math.abs(a.thicknessAxis[2])).toBeCloseTo(1, 6);
  });

  it('prefers the face with more area when one side has a pocket', () => {
    expect(analyzeBody(plate({ topOnlyHole: true })).face.id).toBe('bottom');
  });

  it('takes the long flat side of a square tube, where two sides tie for smallest', () => {
    const tube = plate({ w: 0.4953, h: 0.0508, t: 0.0508, hole: false });
    const a = analyzeBody(tube);
    expect(a.dimensions.map((d) => Number((d * 1000).toFixed(2)))).toEqual([495.3, 50.8, 50.8]);
    // The 495.3 x 50.8 face (area = w * h), not an end.
    expect(a.face.area).toBeCloseTo(0.4953 * 0.0508, 9);
  });

  it('has nothing to say about a body with no flat face', () => {
    expect(analyzeBody({ faces: [{ id: 'c', area: 1, surface: { type: 'cylinder' }, loops: [] }], edges: [], vertices: [] })).toBeNull();
  });
});

describe('sideViews', () => {
  const near = (v, expected) => expected.every((e, i) => Math.abs(v[i] - e) < 1e-6);

  it('gives a plate its TOP, RIGHT and FRONT, each the face on that side, seen from outside', () => {
    const body = plate();
    const views = sideViews(body, analyzeBody(body));
    expect(views.map((v) => v.name)).toEqual(['TOP', 'RIGHT', 'FRONT']);
    const byName = Object.fromEntries(views.map((v) => [v.name, v]));
    expect(byName.TOP.face.id).toBe('top');
    expect(byName.RIGHT.face.id).toBe('right');
    expect(byName.FRONT.face.id).toBe('front');
    expect(near(byName.TOP.outward, [0, 0, 1])).toBe(true);
    expect(near(byName.RIGHT.outward, [1, 0, 0])).toBe(true);
    expect(near(byName.FRONT.outward, [0, -1, 0])).toBe(true);
  });

  it('takes the biggest face on each side: the tube end is small, its sides are long', () => {
    const tube = plate({ w: 0.4953, h: 0.0508, t: 0.0508, hole: false });
    const views = sideViews(tube, analyzeBody(tube));
    const squareMm = (view) => Math.round(view.face.area * 1e6);
    expect(Object.fromEntries(views.map((v) => [v.name, squareMm(v)]))).toEqual({
      TOP: Math.round(0.4953 * 0.0508 * 1e6), RIGHT: Math.round(0.0508 * 0.0508 * 1e6), FRONT: Math.round(0.4953 * 0.0508 * 1e6),
    });
  });

  it('still finds one view of each side when the part is tilted in its Part Studio', () => {
    const body = moved(plate());
    expect(sideViews(body, analyzeBody(body)).map((v) => v.name).sort()).toEqual(['FRONT', 'RIGHT', 'TOP']);
  });

  it('uses the opposite face when a side has none of its own, and leaves a side out with no flat face at all', () => {
    const body = plate();
    body.faces = body.faces.filter((f) => f.id !== 'right');
    const views = sideViews(body, analyzeBody(body));
    expect(views.find((v) => v.name === 'RIGHT').face.id).toBe('left');

    body.faces = body.faces.filter((f) => f.id !== 'left');
    expect(sideViews(body, analyzeBody(body)).map((v) => v.name)).toEqual(['TOP', 'FRONT']);
  });
});

describe('thicknessOption', () => {
  it.each([
    ['1/8 inch', 0.003175, '0.125'],
    ['3 mm, close enough to 1/8 inch', 0.003, '0.125'],
    ['1/4 inch', 0.00635, '0.250'],
    ['0.060 inch', 0.001524, '0.060'],
    ['3/16 inch', 0.0047625, '0.1875'],
  ])('reads %s as a stock thickness', (_, metres, option) => {
    expect(thicknessOption(metres)).toBe(option);
  });

  it.each([
    ['a 2 inch tube', 0.0508],
    ['halfway between stock sizes', 0.0029],
    ['paper thin', 0.0001],
  ])('has no stock thickness for %s', (_, metres) => {
    expect(thicknessOption(metres)).toBeNull();
  });
});

describe('dxfOfFace', () => {
  it('draws the outline and the hole, in millimetres, with the corner at the origin', () => {
    const body = plate();
    const entities = readDxf(dxfOfFace(body, analyzeBody(body)));
    expect(count(entities, 'LINE')).toBe(4);
    expect(count(entities, 'CIRCLE')).toBe(1);
    const xs = entities.filter((e) => e.kind === 'LINE').flatMap((e) => [e[10], e[11]]);
    const ys = entities.filter((e) => e.kind === 'LINE').flatMap((e) => [e[20], e[21]]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 100]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 50]);
    const hole = entities.find((e) => e.kind === 'CIRCLE');
    expect([hole[10], hole[20], hole[40]]).toEqual([50, 25, 5]);
  });

  it('is the same drawing for a part tilted somewhere else in the studio', () => {
    const flat = plate();
    const tilted = moved(plate());
    const a = readDxf(dxfOfFace(flat, analyzeBody(flat)));
    const b = readDxf(dxfOfFace(tilted, analyzeBody(tilted)));
    const extent = (es) => {
      const xs = es.filter((e) => e.kind === 'LINE').flatMap((e) => [e[10], e[11]]);
      const ys = es.filter((e) => e.kind === 'LINE').flatMap((e) => [e[20], e[21]]);
      return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map((v) => Number(v.toFixed(3)));
    };
    expect(extent(b)).toEqual(extent(a));
    expect(count(b, 'CIRCLE')).toBe(1);
  });

  it('draws a rounded corner as an arc that joins its neighbours', () => {
    const body = plate({ corner: true, hole: false });
    const entities = readDxf(dxfOfFace(body, analyzeBody(body)));
    const [arc] = entities.filter((e) => e.kind === 'ARC');
    expect(count(entities, 'LINE')).toBe(4);
    expect(arc).toBeDefined();
    const end = (angle) => [arc[10] + arc[40] * Math.cos((angle * Math.PI) / 180), arc[20] + arc[40] * Math.sin((angle * Math.PI) / 180)];
    const ends = entities.filter((e) => e.kind === 'LINE').flatMap((e) => [[e[10], e[20]], [e[11], e[21]]]);
    const meets = (p) => ends.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3);
    expect(meets(end(arc[50]))).toBe(true);
    expect(meets(end(arc[51]))).toBe(true);
    expect([arc[10], arc[20], arc[40]]).toEqual([90, 40, 10]);
  });

  it('draws a curve that is neither a line nor a circle from the points it is given', () => {
    const body = plate({ hole: false });
    const top = body.faces.find((f) => f.id === 'top');
    // Swap the top edge for a spline.
    const spline = { id: 'Tt', geometry: { startPoint: [0.1, 0.05, 0.003175], endPoint: [0, 0.05, 0.003175] }, curve: { type: 'bspline' } };
    body.edges = body.edges.map((e) => (e.id === 'Tt' ? spline : e));
    const analysis = analyzeBody(body);
    expect(curvedEdgeIds(body, { ...analysis, face: top })).toEqual(['Tt']);
    const curves = new Map([['Tt', [[0.1, 0.05, 0.003175], [0.05, 0.055, 0.003175], [0, 0.05, 0.003175]]]]);
    const entities = readDxf(dxfOfFace(body, { ...analysis, face: top, outward: [0, 0, 1], longAxis: [1, 0, 0] }, curves));
    expect(count(entities, 'LINE')).toBe(3 + 2);
  });
});
