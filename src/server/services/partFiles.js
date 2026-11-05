/**
 * Part Files — what the tool works out from a part's geometry.
 *
 * - Thickness: the part's smallest dimension, when it matches a stock
 *   thickness (used to fill in a new Part).
 * - Files, attached to the Part's ticket: an isometric picture
 *   (`<Part number>.png`) and a STEP (`.step`) of every Part, and DXFs of its
 *   flat sides. A part with a Thickness is flat stock: one DXF (`.dxf`) of its
 *   largest side, the face square to the smallest dimension. A part without
 *   one (a tube) gets the three sides OnShape calls TOP, RIGHT and FRONT
 *   (`_TOP.dxf`, `_RIGHT.dxf`, `_FRONT.dxf`).
 * - A drawing of a plate (a Part with a Thickness) or an axle, with
 *   its holes' sizes and where they are (see `partDrawing`). It is made from
 *   the same reads as the DXFs, so it costs no OnShape call of its own. It
 *   goes on as `.pdf` (to print) and `_drawing.png` (the same page, which the
 *   Assembly page shows).
 */

import {
  analyzeBody, curvedEdgeIds, dxfOfFace, sideViews, thicknessOption,
} from '../utils/partGeometry.js';
import { axleFeatures, plateFeatures } from '../utils/partFeatures.js';
import { drawingPdf } from '../utils/partDrawing.js';
import { pngOfPdf } from '../utils/drawingPng.js';
import { Thickness } from '../utils/bomConstants.js';
import { describeUpstreamError } from '../utils/upstreamError.js';

/** Body details of a workspace are read again after this long; a version's never change. */
const BODY_TTL_MS = 60_000;

const studioKey = (o) => [o.documentId, o.wvmType, o.wvmId, o.elementId, o.configuration ?? ''].join(':');

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
  }

  /** The bodies of a part's Part Studio, read once per studio (and configuration). */
  async _bodies(origin) {
    const key = studioKey(origin);
    const hit = this._studios.get(key);
    if (hit && (origin.wvmType === 'v' || Date.now() - hit.at < BODY_TTL_MS)) return hit.promise;
    const promise = this.onshapeClient.getBodyDetails(origin);
    this._studios.set(key, { at: Date.now(), promise });
    promise.catch(() => this._studios.delete(key));
    return promise;
  }

  /**
   * Points along a face's edges that are neither lines nor circles, read
   * once for the DXF and the drawing of the same face. None needed: no call.
   */
  _curvesOf(origin, body, view) {
    const ids = curvedEdgeIds(body, view);
    if (!ids.length) return Promise.resolve(undefined);
    const key = `${studioKey(origin)}:${origin.partId}:${view.face.id}`;
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
      return measured ? thicknessOption(measured.analysis.thickness) : null;
    } catch (err) {
      console.warn('[files] could not measure', origin.partId, ':', err?.status, err?.message);
      return null;
    }
  }

  /**
   * The DXF files a part gets: its largest side when it has a Thickness,
   * else its TOP, RIGHT and FRONT sides. None for a part with no flat face.
   *
   * @returns {Promise<{ suffix: string, make: () => Promise<string> }[]>}
   */
  async dxfsOf(origin, thickness) {
    const measured = await this.measure(origin);
    if (!measured) return [];
    const { body, analysis } = measured;
    const views = thickness && thickness !== Thickness.NONE
      ? [{ suffix: '', view: analysis }]
      : sideViews(body, analysis).map((view) => ({ suffix: `_${view.name}`, view }));
    return views.map(({ suffix, view }) => ({
      suffix,
      make: async () => dxfOfFace(body, view, await this._curvesOf(origin, body, view)),
    }));
  }

  /**
   * The drawing a part gets: a plate's when it has a Thickness, an axle's
   * when it is one, else none.
   *
   * @param {object} origin
   * @param {string} [thickness]
   * @param {{ partNumber: string, material?: string, tapping?: string }} meta
   * @returns {Promise<{ kind: string, make: () => Promise<Buffer> }|null>}
   */
  async drawingOf(origin, thickness, meta) {
    // Not `measure`: a round axle has no flat face, and is still drawn.
    const body = (await this._bodies(origin)).find((b) => b.id === origin.partId);
    if (!body) return null;
    const analysis = analyzeBody(body);
    if (thickness && thickness !== Thickness.NONE) {
      if (!analysis) return null;
      return {
        kind: 'plate',
        make: async () => drawingPdf(
          plateFeatures(body, analysis, await this._curvesOf(origin, body, analysis)), meta,
        ),
      };
    }
    const axle = axleFeatures(body, analysis);
    return axle ? { kind: 'axle', make: () => drawingPdf(axle, meta) } : null;
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
   * @param {boolean} [params.drawingOnly]   Only the drawing (a backfill): no picture, STEP or DXF, so no OnShape call but the shape
   * @returns {Promise<{ attached: string[], problems: string[] }>}  Never throws
   */
  async attach({ key, partNumber, origin, thickness, material, tapping, drawingOnly = false }) {
    const attached = [];
    const problems = [];
    let have = new Set();
    try {
      const issue = await this.jiraClient.getIssue(key, { fields: ['attachment'] });
      have = new Set((issue?.fields?.attachment ?? []).map((a) => a.filename));
    } catch (err) {
      return { attached, problems: [`couldn't read ${key}: ${describeUpstreamError(err)}`] };
    }

    const files = drawingOnly ? [] : [
      { name: `${partNumber}.png`, make: () => this.onshapeClient.getPartImage(origin) },
      { name: `${partNumber}.step`, make: () => this.onshapeClient.exportPartStep(origin) },
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
      const drawing = await this.drawingOf(origin, thickness, {
        partNumber, material: material && material !== 'None' ? material : undefined, tapping,
      });
      if (drawing) {
        // Made once for both files, and only if one of them is missing.
        let pdf = null;
        const makePdf = () => { pdf ??= drawing.make(); return pdf; };
        files.push({ name: `${partNumber}.pdf`, make: makePdf });
        files.push({ name: `${partNumber}_drawing.png`, make: async () => pngOfPdf(await makePdf()) });
      }
    } catch (err) {
      console.warn('[files]', key, 'could not measure for the drawing:', err?.status, err?.message);
      problems.push(`${partNumber}.pdf: ${describeUpstreamError(err)}`);
    }
    for (const file of files) {
      if (have.has(file.name)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const content = await file.make();
        // eslint-disable-next-line no-await-in-loop
        await this.jiraClient.addAttachment(key, file.name, content);
        attached.push(file.name);
      } catch (err) {
        console.warn('[files]', key, file.name, 'failed:', err?.status, err?.message);
        problems.push(`${file.name}: ${describeUpstreamError(err)}`);
      }
    }
    return { attached, problems };
  }
}
