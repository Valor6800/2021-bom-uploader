/**
 * Part Files — what the tool works out from a part's geometry, at the cut.
 *
 * - Thickness: the part's smallest dimension, when it is plate stock.
 *   Measured from the same read as the DXFs and written to a Part still at
 *   None (not a 3D print); the files that follow are then a plate's.
 * - Needs Tapping?: Yes when OnShape's Hole feature made a tapped hole in
 *   the part (one FeatureScript read per Part Studio). Never set back to
 *   No: a hole made another way can still be tapped by hand.
 * - Files, attached to the Part's ticket (see `partViews` for which views):
 *   - `<Part number>.png`, an isometric picture drawn from the shape read
 *     (no call of its own; `isoPicture`), and `.step` for a 3D print
 *     (one export per Part Studio for a Build's 3D prints: `attachSteps`).
 *   - DXFs. A plate: `.dxf` of its through cuts, one per pocket depth
 *     (`_POCKET_0.125.dxf`; `_REAR_POCKET_…` from the back), all seen
 *     from the pocket side with one 0,0; when the back shows more than the
 *     through cuts, `_REAR.dxf` (them seen from the back, sharing the rear
 *     pockets' 0,0) and a rear drawing; and `_<SIDE>.dxf` of an edge with
 *     features. Anything else: `_TOP.dxf`, `_RIGHT.dxf`, `_FRONT.dxf`, and
 *     `_BOTTOM`/`_LEFT`/`_BACK` when that side shows different features. A
 *     plain face (a rectangle with nothing in it) gets no DXF.
 *   - Drawings (see `partDrawing`): `_drawing.png` (a plate's or an axle's
 *     own), `_drawing_<SIDE>.png` for each side view, plain ones included
 *     (they give the stock size), and `_drawings.pdf` with them all.
 *   All from the same reads, so the DXFs and drawings cost no OnShape call
 *   of their own.
 */

import {
  analyzeBody, curvedEdgeIds, depthName, dxfOfFace, faceLayout, plateThickness, plateViews,
} from '../utils/partGeometry.js';
import { axleFeatures, faceFeatures, plateFeatures } from '../utils/partFeatures.js';
import { drawingPdf, drawingsPdf } from '../utils/partDrawing.js';
import { plateRearView, sideViewPlan } from '../utils/partViews.js';
import { pngOfPdf } from '../utils/drawingPng.js';
import { HOLE_SCRIPT, holesByPart } from '../utils/holeFeatures.js';
import { isZip, unzip } from '../utils/unzip.js';
import { colorFrom, isoPicture } from '../utils/isoPicture.js';
import { Machinery, Tapping, Thickness } from '../utils/bomConstants.js';

const THICKNESS_FIELD = 'customfield_10207';
const TAPPING_FIELD = 'customfield_10600';
import { describeUpstreamError } from '../utils/upstreamError.js';

/** Body details of a workspace are read again after this long; a version's never change. */
const BODY_TTL_MS = 60_000;

const studioKey = (o) => [o.documentId, o.wvmType, o.wvmId, o.elementId, o.configuration ?? ''].join(':');

/** How long a Part Studio OnShape refused (403, 404) is not asked for again. */
const REFUSED_MS = 10 * 60 * 1000;

/** Part Studios' body details kept at once (a big one is a few MB). */
const MAX_STUDIOS = 40;

/**
 * Body details never change for a version, nor for a workspace at one Part
 * Studio version (the BOM's `microversionId`), so both are kept until
 * pushed out; a workspace read without one is kept a minute.
 */
const bodyKey = (o) => `${studioKey(o)}:${o.wvmType === 'w' ? o.microversionId ?? '' : ''}`;
const keepsForGood = (o) => o.wvmType === 'v' || !!o.microversionId;

export class PartFiles {
  /**
   * @param {object} deps
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   */
  constructor({ onshapeClient, jiraClient }) {
    this.onshapeClient = onshapeClient;
    this.jiraClient = jiraClient;
    this._studios = new Map();
    this._curves = new Map();
    this._holes = new Map();
  }

  /**
   * The hole faces of a part, from OnShape's Hole feature: one read per Part
   * Studio (and configuration), kept like the body details.
   * @returns {Promise<object[]>}  As `holesByPart` gives them; [] for a part with none
   */
  async holesOf(origin) {
    const key = studioKey(origin);
    let hit = this._holes.get(key);
    if (!hit || (origin.wvmType !== 'v' && Date.now() - hit.at >= BODY_TTL_MS)) {
      const promise = this.onshapeClient.evalFeatureScript(origin, HOLE_SCRIPT).then(holesByPart);
      hit = { at: Date.now(), promise };
      this._holes.set(key, hit);
      promise.catch(() => this._holes.delete(key));
    }
    return (await hit.promise).get(origin.partId) ?? [];
  }

  /** The bodies of a part's Part Studio, read once per studio (and configuration). */
  async _bodies(origin) {
    const key = bodyKey(origin);
    const hit = this._studios.get(key);
    if (hit && (keepsForGood(origin) || Date.now() - hit.at < BODY_TTL_MS || hit.refused)) {
      // Most recently used last, so the oldest goes first.
      this._studios.delete(key);
      this._studios.set(key, hit);
      return hit.promise;
    }
    const promise = this.onshapeClient.getBodyDetails(origin);
    this._studios.set(key, { at: Date.now(), promise });
    if (this._studios.size > MAX_STUDIOS) this._studios.delete(this._studios.keys().next().value);
    promise.catch((err) => {
      // A Part Studio the team can't read stays refused a while, so its other parts don't ask again.
      if (err?.status === 403 || err?.status === 404) {
        const entry = this._studios.get(key);
        if (entry?.promise === promise) entry.refused = true;
        setTimeout(() => { if (this._studios.get(key)?.promise === promise) this._studios.delete(key); }, REFUSED_MS).unref?.();
      } else {
        this._studios.delete(key);
      }
    });
    return promise;
  }

  /** True when this part's Part Studio shape is read and kept already (no call to draw it). */
  hasShape(origin) {
    const hit = this._studios.get(bodyKey(origin));
    return !!hit && !hit.refused && (keepsForGood(origin) || Date.now() - hit.at < BODY_TTL_MS);
  }

  /**
   * A part's isometric picture, drawn from its body details: no OnShape call
   * beyond the Part Studio's shape read, which the DXFs and drawings share.
   *
   * @param {object} origin
   * @param {number[]|null} [color]  Its colour in OnShape (the BOM's), else steel grey
   * @param {{ width?: number, height?: number }} [size]
   * @returns {Promise<Buffer|null>}  PNG; null for a part OnShape doesn't list, or one with no edges to draw
   */
  async pictureOf(origin, color = null, { width = 800, height = 600 } = {}) {
    const body = (await this._bodies(origin)).find((b) => b.id === origin.partId);
    if (!body?.edges?.length) return null;
    try {
      return isoPicture(body, { color: colorFrom(color ? { red: color[0], green: color[1], blue: color[2] } : null), width, height });
    } catch (err) {
      console.warn('[files] could not draw', origin.partId, ':', err?.message);
      return null;
    }
  }

  /**
   * Points along the edges of these views that are neither lines nor
   * circles, in one read for all of them, shared by the DXFs and the
   * drawing of the same views. None needed: no call.
   */
  _curvesOf(origin, body, views) {
    const ids = [...new Set([views].flat().flatMap((v) => curvedEdgeIds(body, v)))].sort();
    if (!ids.length) return Promise.resolve(undefined);
    const key = `${studioKey(origin)}:${origin.partId}:${ids.join(',')}`;
    const hit = this._curves.get(key);
    if (hit && (origin.wvmType === 'v' || Date.now() - hit.at < BODY_TTL_MS)) return hit.promise;
    const promise = this.onshapeClient.getTessellatedEdges(origin, ids);
    this._curves.set(key, { at: Date.now(), promise });
    promise.catch(() => this._curves.delete(key));
    return promise;
  }

  /** @returns {Promise<{ body: object, analysis: object }|null>}  Null when the part has no flat face */
  async measure(origin) {
    const body = (await this._bodies(origin)).find((b) => b.id === origin.partId);
    const analysis = body ? analyzeBody(body) : null;
    return analysis ? { body, analysis } : null;
  }

  /**
   * The Thickness option this part's smallest dimension matches, if any.
   * Never throws: a part that can't be measured is simply left as it is.
   *
   * @returns {Promise<string|null>}
   */
  async thicknessOf(origin) {
    try {
      const measured = await this.measure(origin);
      return measured ? plateThickness(measured.analysis) : null;
    } catch (err) {
      console.warn('[files] could not measure', origin.partId, ':', err?.status, err?.message);
      return null;
    }
  }

  /**
   * The part's views and what each gets (see `partViews`): a plate's
   * profile and pockets when it has a Thickness, an axle's own drawing, and
   * the side views. Null for a part OnShape doesn't list.
   * @private
   */
  async _plan(origin, thickness) {
    const body = (await this._bodies(origin)).find((b) => b.id === origin.partId);
    if (!body) return null;
    const analysis = analyzeBody(body);
    const plate = !!(analysis && thickness && thickness !== Thickness.NONE);
    const axle = !plate && !!axleFeatures(body, analysis);
    const sides = analysis ? sideViewPlan(body, analysis, { plate, axle }) : [];
    const plateSet = plate ? plateViews(body, analysis) : null;
    const rear = plateSet ? plateRearView(body, analysis, plateSet.profile) : null;
    // Every view this part is drawn in, so their curved edges are read at once.
    const views = [
      ...(plateSet ? [plateSet.profile, ...plateSet.pockets.map((p) => p.view)] : []),
      ...(rear ? [rear] : []),
      ...sides.map((e) => e.view),
    ];
    return { body, analysis, plate, axle, sides, plateSet, rear, curves: () => this._curvesOf(origin, body, views) };
  }

  /**
   * The DXF files a part gets: a plate's through cuts and one per pocket
   * depth, and a DXF of each side view that has something to cut (a plain
   * face gets none). None for a part with no flat face.
   *
   * @returns {Promise<{ suffix: string, make: () => Promise<string> }[]>}
   */
  async dxfsOf(origin, thickness) {
    const plan = await this._plan(origin, thickness);
    if (!plan?.analysis) return [];
    const { body, sides, plateSet, rear, curves } = plan;
    const sideFiles = sides.filter((e) => e.dxf).map((e) => ({
      suffix: `_${e.name}`,
      make: async () => dxfOfFace(body, e.view, await curves()),
    }));
    if (!plateSet) return sideFiles;

    const { profile, pockets } = plateSet;
    // Every file shares the profile's 0,0; the rear's share the profile's seen from the back.
    const fromBack = { ...profile, outward: profile.outward.map((v) => -v) };
    const origins = async () => {
      const c = await curves();
      const front = faceLayout(body, profile, c).origin;
      const back = rear || pockets.some((p) => p.back) ? faceLayout(body, fromBack, c).origin : null;
      return { c, front, back };
    };
    return [
      { suffix: '', make: async () => dxfOfFace(body, profile, await curves(), { layer: 'PROFILE' }) },
      ...pockets.map((p) => {
        const name = `${p.back ? '_REAR' : ''}_POCKET_${depthName(p.depth)}`;
        return {
          suffix: name,
          make: async () => {
            const { c, front, back } = await origins();
            return dxfOfFace(body, p.view, c, { origin: p.back ? back : front, layer: name.slice(1) });
          },
        };
      }),
      // The through cuts seen from the back, for the rear setup.
      ...(rear ? [{
        suffix: '_REAR',
        make: async () => {
          const { c, back } = await origins();
          return dxfOfFace(body, fromBack, c, { origin: back, layer: 'REAR' });
        },
      }] : []),
      ...sideFiles,
    ];
  }

  /**
   * The drawings a part gets: a plate's or an axle's own (suffix ''), then
   * one per side view (`_TOP`, …), plain faces included, for the stock size.
   *
   * @param {object} origin
   * @param {string} [thickness]
   * @param {() => Promise<object[]|null>} [holes]  The part's hole faces (null: couldn't read)
   * @returns {Promise<{ suffix: string, features: () => Promise<object> }[]>}
   */
  async drawingsOf(origin, thickness, holes = async () => null) {
    const plan = await this._plan(origin, thickness);
    if (!plan) return [];
    const { body, analysis, plate, axle, sides, rear, curves } = plan;
    const once = (fn) => { let p = null; return () => { p ??= fn(); return p; }; };
    const list = [];
    if (plate) list.push({ suffix: '', features: once(async () => plateFeatures(body, analysis, await curves(), await holes())) });
    if (rear) {
      list.push({
        suffix: '_REAR',
        features: once(async () => plateFeatures(body, analysis, await curves(), await holes(), { rear: true })),
      });
    }
    if (axle) list.push({ suffix: '', features: once(async () => axleFeatures(body, analysis, await holes())) });
    for (const e of sides) {
      list.push({
        suffix: `_${e.name}`,
        features: once(async () => faceFeatures(body, e.view, await curves(), await holes(), analysis)),
      });
    }
    return list;
  }

  /**
   * Attach the part's picture, STEP and DXFs to its ticket, skipping any the ticket
   * already has (so a retry adds only what is missing).
   *
   * @param {object} params
   * @param {string} params.key              The Part's ticket
   * @param {string} params.partNumber       Full number, e.g. "VR27P-1103A"
   * @param {object} params.origin           Where the part lives in OnShape
   * @param {string} [params.thickness]      The Part's Thickness: set means one DXF, None means three
   * @param {string} [params.material]       For the drawing's title block
   * @param {string} [params.tapping]        The Part's Needs Tapping?, for the drawing's hole notes
   * @param {string} [params.machinery]      A 3D print is never given a Thickness
   * @param {boolean} [params.drawingOnly]   Only the drawing (a backfill): no picture, STEP or DXF, so no OnShape call but the shape
   * @param {number[]|null} [params.color]   Its colour in OnShape, for its picture
   * @param {'here'|'later'} [params.step]   A 3D print's STEP: exported here (alone), or `later` by the
   *   caller with its Part Studio's others (`attachSteps`), when `needsStep` says so
   * @returns {Promise<{ attached: string[], problems: string[], thickness?: string, tapping?: string }>}
   *   Never throws. `thickness`, `tapping`: what it found and wrote to the Part
   */
  async attach({
    key, partNumber, origin, thickness, material, machinery, tapping, drawingOnly = false, step = 'here', color = null,
  }) {
    const attached = [];
    const problems = [];
    let have = new Set();
    try {
      const issue = await this.jiraClient.getIssue(key, { fields: ['attachment'] });
      have = new Set((issue?.fields?.attachment ?? []).map((a) => a.filename));
    } catch (err) {
      return { attached, problems: [`couldn't read ${key}: ${describeUpstreamError(err)}`] };
    }

    // A Part with its DXFs already measured once: don't read its shape again for this.
    const measured = have.has(`${partNumber}_drawings.pdf`)
      || [...have].some((n) => n.startsWith(partNumber) && n.endsWith('.dxf'));
    let found = null;
    if ((!thickness || thickness === Thickness.NONE) && machinery !== Machinery.THREE_D_PRINTER && !measured) {
      try {
        found = await this.thicknessOf(origin);
        if (found) {
          await this.jiraClient.updateIssue(key, { [THICKNESS_FIELD]: { value: found } });
          thickness = found;
        }
      } catch (err) {
        console.warn('[files]', key, "couldn't save its Thickness:", err?.status, err?.message);
        problems.push(`Thickness ${found}: ${describeUpstreamError(err)}`);
        found = null;
      }
    }

    // The Hole feature's tapped holes, read once, when the part's files are
    // first made or its drawing is: they set Needs Tapping? and the callouts.
    const meta = { partNumber, material: material && material !== 'None' ? material : undefined, tapping };
    let tapped = null;
    let holesRead = null;
    const holes = () => {
      holesRead ??= this.holesOf(origin).then(async (faces) => {
        if (faces.some((h) => h.tapped) && meta.tapping !== Tapping.YES) {
          try {
            await this.jiraClient.updateIssue(key, { [TAPPING_FIELD]: { value: Tapping.YES } });
            meta.tapping = Tapping.YES;
            tapped = Tapping.YES;
          } catch (err) {
            console.warn('[files]', key, "couldn't save Needs Tapping?:", err?.status, err?.message);
            problems.push(`Needs Tapping? Yes: ${describeUpstreamError(err)}`);
          }
        }
        return faces;
      }).catch((err) => {
        console.warn('[files]', key, "couldn't read its holes:", err?.status, err?.message);
        problems.push(`Needs Tapping?: couldn't read the holes: ${describeUpstreamError(err)}`);
        return null;
      });
      return holesRead;
    };
    if (!measured && machinery !== Machinery.THREE_D_PRINTER) await holes();

    // A STEP only for a 3D print (for the slicer); everything else is cut from DXFs.
    const wantsStep = !drawingOnly && machinery === Machinery.THREE_D_PRINTER && !have.has(`${partNumber}.step`);
    // Started first and collected last, so the export runs while the rest is made.
    let stepExport = null;
    if (wantsStep && step === 'here') {
      stepExport = this.onshapeClient.startStepExport(origin, [origin.partId])
        .then((id) => this.onshapeClient.exportResult(origin.documentId, id));
      stepExport.catch(() => {});
    }
    // Drawn from the shape read, not OnShape's shaded view (a call per part).
    const files = drawingOnly ? [] : [
      // Never OnShape's picture: a part with nothing to draw goes without one.
      { name: `${partNumber}.png`, make: () => this.pictureOf(origin, color) },
    ];
    if (!drawingOnly) {
      try {
        for (const dxf of await this.dxfsOf(origin, thickness)) {
          files.push({ name: `${partNumber}${dxf.suffix}.dxf`, make: dxf.make });
        }
      } catch (err) {
        console.warn('[files]', key, 'could not measure for the DXF:', err?.status, err?.message);
        problems.push(`${partNumber}.dxf: ${describeUpstreamError(err)}`);
      }
    }
    try {
      // A picture of each drawing, and one PDF of them all.
      const drawings = await this.drawingsOf(origin, thickness, holes);
      for (const d of drawings) {
        files.push({ name: `${partNumber}_drawing${d.suffix}.png`, make: async () => pngOfPdf(await drawingPdf(await d.features(), meta)) });
      }
      if (drawings.length) {
        files.push({
          name: `${partNumber}_drawings.pdf`,
          make: async () => drawingsPdf(await Promise.all(drawings.map((d) => d.features())), meta),
        });
      }
    } catch (err) {
      console.warn('[files]', key, 'could not measure for the drawings:', err?.status, err?.message);
      problems.push(`${partNumber}_drawings: ${describeUpstreamError(err)}`);
    }
    for (const file of files) {
      if (have.has(file.name)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const content = await file.make();
        if (content == null) continue; // nothing to attach
        // eslint-disable-next-line no-await-in-loop
        await this.jiraClient.addAttachment(key, file.name, content);
        attached.push(file.name);
      } catch (err) {
        console.warn('[files]', key, file.name, 'failed:', err?.status, err?.message);
        problems.push(`${file.name}: ${describeUpstreamError(err)}`);
      }
    }
    if (stepExport) {
      try {
        await this.jiraClient.addAttachment(key, `${partNumber}.step`, await stepExport);
        attached.push(`${partNumber}.step`);
      } catch (err) {
        console.warn('[files]', key, 'STEP failed:', err?.status, err?.message);
        problems.push(`${partNumber}.step: ${describeUpstreamError(err)}`);
      }
    }
    return {
      attached,
      problems,
      ...(found ? { thickness: found } : {}),
      ...(tapped ? { tapping: tapped } : {}),
      ...(wantsStep && step === 'later' ? { needsStep: true } : {}),
    };
  }

  /**
   * The STEPs of several 3D prints of one Part Studio, in one export: each
   * comes back as its own file in a zip, named by its part. A part the zip
   * can't be matched to (two parts named alike) is exported on its own.
   *
   * @param {object} studio  `{ documentId, wvmType, wvmId, elementId, configuration? }`
   * @param {{ key: string, partNumber: string, partId: string, name?: string }[]} parts
   * @returns {Promise<Map<string, { attached: string[], problems: string[] }>>}  By ticket key. Never throws
   */
  async attachSteps(studio, parts) {
    const out = new Map(parts.map((p) => [p.key, { attached: [], problems: [] }]));
    const put = async (part, data) => {
      const name = `${part.partNumber}.step`;
      try {
        await this.jiraClient.addAttachment(part.key, name, data);
        out.get(part.key).attached.push(name);
      } catch (err) {
        out.get(part.key).problems.push(`${name}: ${describeUpstreamError(err)}`);
      }
    };
    let files = [];
    try {
      const id = await this.onshapeClient.startStepExport(studio, parts.map((p) => p.partId));
      const bytes = Buffer.from(await this.onshapeClient.exportResult(studio.documentId, id));
      files = isZip(bytes) ? unzip(bytes) : [{ name: parts.length === 1 ? 'only' : '', data: bytes }];
    } catch (err) {
      console.warn('[files] STEP export failed:', err?.status, err?.message);
      for (const p of parts) out.get(p.key).problems.push(`${p.partNumber}.step: ${describeUpstreamError(err)}`);
      return out;
    }
    const loose = [];
    for (const part of parts) {
      const file = parts.length === 1 && files.length === 1 ? files[0] : stepFileFor(files, part.name);
      if (file) await put(part, file.data); // eslint-disable-line no-await-in-loop
      else loose.push(part);
    }
    for (const part of loose) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await put(part, await this.onshapeClient.exportPartStep({ ...studio, partId: part.partId }));
      } catch (err) {
        out.get(part.key).problems.push(`${part.partNumber}.step: ${describeUpstreamError(err)}`);
      }
    }
    return out;
  }
}

/** Letters and digits only, lower case: names as file names may mangle them. */
const plain = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The zip's file for a part: OnShape names each `<Part Studio> - <part>.step`.
 * The BOM's name may have lost a bracketed prefix, so the end of the name is
 * matched; none or two matching is no match.
 */
function stepFileFor(files, name) {
  if (!name) return null;
  const exact = files.filter((f) => f.name.replace(/\.step$/i, '').endsWith(` - ${name}`));
  if (exact.length === 1) return exact[0];
  const want = plain(name);
  const loose = files.filter((f) => plain(f.name.replace(/\.step$/i, '')).endsWith(want));
  return loose.length === 1 ? loose[0] : null;
}
