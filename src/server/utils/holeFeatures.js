/**
 * Which holes are tapped, from OnShape's Hole feature: one FeatureScript
 * call per Part Studio reads the hole attribute the Hole feature puts on
 * each hole's faces. Unlike a hole's size (0.201 in is both a 1/4-20 tap
 * drill and a #10 clearance hole), it says whether the hole is tapped, to
 * what thread and how deep.
 *
 * A hole made some other way (a sketch and an extrude cut) carries no
 * attribute, so it reads as not tapped.
 */

/** Every face with a hole attribute: its part, and the attribute's tapping. */
export const HOLE_SCRIPT = `function(context is Context, queries) {
  var out = [];
  for (var face in evaluateQuery(context, qEverything(EntityType.FACE))) {
    var holes = getHoleAttributes(context, face);
    if (size(holes) > 0) {
      var h = holes[0];
      out = append(out, {
        "face" : transientQueriesToStrings(face),
        "part" : transientQueriesToStrings(evaluateQuery(context, qOwnerBody(face))[0]),
        "tapped" : h.isTappedHole == true,
        "tapSize" : h.tapSize == undefined ? "" : h.tapSize,
        "through" : h.isTappedThrough == true,
        "depth" : h.tappedDepth == undefined ? 0 : h.tappedDepth / meter,
        "major" : h.majorDiameter == undefined ? 0 : h.majorDiameter / meter
      });
    }
  }
  return out;
}`;

/** OnShape's typed FeatureScript value, as plain JSON. */
export function plainValue(v) {
  if (!v || typeof v !== 'object') return v;
  const m = v.message ?? {};
  switch (v.typeName) {
    case 'BTFSValueArray': return (m.value ?? []).map(plainValue);
    case 'BTFSValueMap':
      return Object.fromEntries((m.value ?? []).map((e) => [plainValue(e.message.key), plainValue(e.message.value)]));
    case 'BTFSValueString':
    case 'BTFSValueNumber':
    case 'BTFSValueBoolean':
      return m.value;
    case 'BTFSValueUndefined':
      return null;
    default:
      return m.value !== undefined ? plainValue(m.value) : null;
  }
}

/**
 * The holes of each part, from the script's answer.
 *
 * @param {object} response  The featurescript call's response
 * @returns {Map<string, { faceId: string, tapped: boolean, tapSize: string|null, through: boolean,
 *   depth: number, major: number }[]>}  part id -> its hole faces (metres)
 */
export function holesByPart(response) {
  const rows = plainValue(response?.result);
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.part || !row?.face) continue;
    if (!out.has(row.part)) out.set(row.part, []);
    out.get(row.part).push({
      faceId: row.face,
      tapped: row.tapped === true,
      tapSize: row.tapSize || null,
      through: row.through === true,
      depth: Number(row.depth) || 0,
      major: Number(row.major) || 0,
    });
  }
  return out;
}

/**
 * Tapping by edge: each tapped hole face's edges, so a hole found by its
 * outline (a circle on a plate's face, a bore's rim) can be matched to it.
 *
 * @param {object} body
 * @param {ReturnType<typeof holesByPart> extends Map<any, infer T> ? T : never} holes
 * @returns {Map<string, object>}  edge id or face id -> the tapped hole
 */
export function tappedByEntity(body, holes) {
  const out = new Map();
  const faces = new Map((body?.faces ?? []).map((f) => [f.id, f]));
  for (const hole of holes ?? []) {
    if (!hole.tapped) continue;
    out.set(hole.faceId, hole);
    for (const loop of faces.get(hole.faceId)?.loops ?? []) {
      for (const { edgeId } of loop.coedges ?? []) out.set(edgeId, hole);
    }
  }
  return out;
}
