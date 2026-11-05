/**
 * Pictures — what the tool shows as images.
 *
 * - A Part's picture is the `<Part number>.png` attached to its ticket when
 *   the Part was made; its drawing (plates and axles) is the
 *   `<Part number>_drawing.png` attached when its Build was cut (for a part
 *   with only side views, the first `_drawing_<SIDE>.png`).
 * - A Build's picture is its Assembly in OnShape's isometric view. A cut Build
 *   gets one attached to its ticket, rendered from the version it was cut at
 *   (so it never changes). A Draft has none yet: it is rendered live from the
 *   workspace for the tool to show, and not stored.
 *
 * Jira needs a login to read an attachment, so the tool serves the bytes.
 */

import { HttpError, badRequest } from '../middleware/httpError.js';
import { BuildField } from '../utils/buildConstants.js';
import { applyPartMask, applyTitleMask } from '../utils/partMask.js';
import { describeUpstreamError } from '../utils/upstreamError.js';
import { configurationFrom } from '../utils/onshapeConfiguration.js';

const PNG = /\.png$/i;
/** Side views in the order a Part's drawings list them. */
const SIDE_ORDER = ['TOP', 'BOTTOM', 'RIGHT', 'LEFT', 'FRONT', 'BACK'];
const VERSION_LINK_RE = /\/documents\/([a-f0-9]{24})\/v\/([a-f0-9]{24})\/e\/([a-f0-9]{24})/i;

/** A live render is reused this long (an assembly takes several seconds to draw). */
const LIVE_TTL_MS = 5 * 60 * 1000;

/** Attachments kept in memory, newest last. */
const MAX_FILES = 300;

export class Pictures {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   * @param {import('./partFiles.js').PartFiles} [deps.partFiles]  Draws a part from its shape (live pictures)
   */
  constructor({ jiraClient, onshapeClient, partFiles = null }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.partFiles = partFiles;
    /** live picture key -> PNG, newest last */
    this._live = new Map();
    /** attachment id -> bytes */
    this._files = new Map();
    /** render key -> { at, promise } */
    this._renders = new Map();
    /** Builds already tried for a missing picture this run */
    this._healed = new Set();
  }

  async _issue(key, fields) {
    try {
      return await this.jiraClient.getIssue(key, { fields });
    } catch (err) {
      if (err?.status === 404) throw new HttpError(404, `No ${key} found`);
      throw err;
    }
  }

  /** An attachment's bytes, kept in memory (an attachment never changes). */
  async _attachment(attachment) {
    const hit = this._files.get(attachment.id);
    if (hit) {
      this._files.delete(attachment.id);
      this._files.set(attachment.id, hit);
      return hit;
    }
    const bytes = await this.jiraClient.getAttachmentContent(attachment.content);
    this._files.set(attachment.id, bytes);
    if (this._files.size > MAX_FILES) this._files.delete(this._files.keys().next().value);
    return bytes;
  }

  /** `make()`, shared by callers asking at once and remembered for `ttl` (null: for good). */
  _render(key, ttl, make) {
    const hit = this._renders.get(key);
    if (hit && (ttl === null || Date.now() - hit.at < ttl)) return hit.promise;
    const promise = make();
    this._renders.set(key, { at: Date.now(), promise });
    promise.catch(() => this._renders.delete(key));
    return promise;
  }

  /**
   * A Part's picture.
   * @param {string} key
   * @returns {Promise<Buffer>}
   * @throws {HttpError} 400 for a ticket that is not a Part, 404 when it has no picture
   */
  async partImage(key) {
    return this._partFile(key, '.png', 'This Part has no picture.');
  }

  /**
   * A part's picture as it is in OnShape now, for the Designer, drawn from
   * its Part Studio's shape. The shape read is kept per Part Studio version,
   * so it is read again only after the Part Studio changes (the caller names
   * the version it saw in the BOM, `microversionId`).
   *
   * @param {{ documentId: string, wvmType: string, wvmId: string, elementId: string, partId: string,
   *   configuration?: string|null, microversionId?: string|null }} origin
   * @param {number[]|null} [color]
   * @returns {Promise<Buffer>}
   * @throws {HttpError} 404 for a part OnShape doesn't list
   */
  async cadPicture(origin, color = null) {
    if (!this.partFiles) throw new HttpError(404, 'Live pictures are off.');
    const key = JSON.stringify([origin, color]);
    if (origin.microversionId || origin.wvmType === 'v') {
      const hit = this._live.get(key);
      if (hit) return hit;
    }
    const png = await this.partFiles.pictureOf(origin, color);
    if (!png) throw new HttpError(404, 'OnShape has no such part.');
    if (origin.microversionId || origin.wvmType === 'v') {
      this._live.set(key, png);
      if (this._live.size > MAX_FILES) this._live.delete(this._live.keys().next().value);
    }
    return png;
  }

  /**
   * A Part's drawing, as a picture.
   * @param {string} key
   * @returns {Promise<Buffer>}
   * @throws {HttpError} 400 for a ticket that is not a Part, 404 when it has no drawing
   */
  async partDrawing(key) {
    // A plate's or axle's own drawing, else its first side view's.
    return this._partFile(key, ['_drawing.png', ...SIDE_ORDER.map((s) => `_drawing_${s}.png`)], 'This Part has no drawing.');
  }

  /** The first of `<Part number><suffix>` attached to a Part's ticket. */
  async _partFile(key, suffixes, missing) {
    const issue = await this._issue(key, ['issuetype', 'summary', 'attachment']);
    if (issue?.fields?.issuetype?.name !== 'Part') throw badRequest(`"${key}" is not a Part`);
    const number = applyPartMask(issue.fields.summary ?? '')?.fullPartNumber;
    const files = issue.fields.attachment ?? [];
    for (const suffix of [suffixes].flat()) {
      const attachment = files.find((a) => a.filename === `${number}${suffix}`);
      if (attachment) return this._attachment(attachment);
    }
    throw new HttpError(404, missing);
  }

  /**
   * A Build's picture: the one attached when it was cut, else its cut
   * version drawn now, else (a Draft) the workspace drawn now.
   *
   * @param {string} buildKey
   * @param {{ fresh?: boolean }} [options]  Draw a Draft again instead of reusing a recent drawing
   * @returns {Promise<{ image: Buffer, live: boolean }>}  `live`: it may change, so don't keep it
   */
  async buildImage(buildKey, { fresh = false } = {}) {
    const issue = await this._issue(buildKey, [
      'issuetype', BuildField.ASSEMBLY_LINK, BuildField.BUILD_NUMBER, BuildField.ONSHAPE_VERSION_LINK, 'attachment',
    ]);
    const f = issue?.fields ?? {};
    if (f.issuetype?.name !== 'Build') throw badRequest(`"${buildKey}" is not a Build`);

    const attached = (f.attachment ?? []).find((a) => PNG.test(a.filename));
    if (attached) return { image: await this._attachment(attached), live: false };

    // The Assembly, for the configuration it follows (and the ids a Draft is drawn from).
    const assembly = await this._issue(f[BuildField.ASSEMBLY_LINK], [
      'customfield_10300', 'customfield_10301', 'customfield_10302', 'description',
    ]);
    const configuration = configurationFrom(assembly?.fields?.description);
    const where = configuration ? { configuration } : {};

    const version = VERSION_LINK_RE.exec(f[BuildField.ONSHAPE_VERSION_LINK] ?? '');
    if (version) {
      const image = await this._render(`v:${version[2]}:${version[3]}:${configuration ?? ''}`, null, () => this.onshapeClient.getAssemblyImage({
        documentId: version[1], wvmType: 'v', wvmId: version[2], elementId: version[3], ...where,
      }, { width: 1000, height: 700 }));
      // A cut Build with no picture on its ticket (cut before pictures, or one that failed): attach it.
      if (!this._healed.has(buildKey)) {
        this._healed.add(buildKey);
        this.attachBuildImage({
          buildKey, buildNumber: f[BuildField.BUILD_NUMBER], assemblyKey: f[BuildField.ASSEMBLY_LINK], versionLink: f[BuildField.ONSHAPE_VERSION_LINK],
        }).then((r) => { if (r.problem) console.warn('[pictures]', buildKey, r.problem); });
      }
      return { image, live: false };
    }

    // A Draft: the workspace as it is now.
    const [documentId, workspaceId, elementId] = [assembly?.fields?.customfield_10300, assembly?.fields?.customfield_10301, assembly?.fields?.customfield_10302];
    if (!documentId || !workspaceId || !elementId) throw new HttpError(404, 'This Assembly has no OnShape link.');
    const key = `w:${workspaceId}:${elementId}:${configuration ?? ''}`;
    if (fresh) this._renders.delete(key);
    const image = await this._render(key, LIVE_TTL_MS, () => this.onshapeClient.getAssemblyImage({
      documentId, wvmType: 'w', wvmId: workspaceId, elementId, ...where,
    }, { width: 1000, height: 700 }));
    return { image, live: true };
  }

  /**
   * Draw a cut Build's Assembly from its version and attach it to the Build's
   * ticket as `<Assembly number> Build <N>.png`, unless it has a picture.
   * Never throws.
   *
   * @param {object} params
   * @param {string} params.buildKey
   * @param {number|null} params.buildNumber
   * @param {string} params.assemblyKey
   * @param {string} params.versionLink  The Build's OnShape version link
   * @returns {Promise<{ attached: boolean, problem?: string }>}
   */
  async attachBuildImage({ buildKey, buildNumber, assemblyKey, versionLink }) {
    try {
      const version = VERSION_LINK_RE.exec(versionLink ?? '');
      if (!version) return { attached: false, problem: 'the Build has no OnShape version' };

      const build = await this.jiraClient.getIssue(buildKey, { fields: ['attachment'] });
      if ((build?.fields?.attachment ?? []).some((a) => PNG.test(a.filename))) return { attached: false };

      const assembly = await this.jiraClient.getIssue(assemblyKey, { fields: ['summary', 'description'] });
      const summary = assembly?.fields?.summary ?? '';
      const label = (applyTitleMask(summary)?.fullPartNumber ?? assemblyKey);
      const configuration = configurationFrom(assembly?.fields?.description);
      const image = await this._render(`v:${version[2]}:${version[3]}:${configuration ?? ''}`, null, () => this.onshapeClient.getAssemblyImage({
        documentId: version[1], wvmType: 'v', wvmId: version[2], elementId: version[3], ...(configuration ? { configuration } : {}),
      }, { width: 1000, height: 700 }));
      await this.jiraClient.addAttachment(buildKey, `${label} Build ${buildNumber ?? ''}`.trim() + '.png', image);
      return { attached: true };
    } catch (err) {
      return { attached: false, problem: describeUpstreamError(err) };
    }
  }
}
