/**
 * Assembly guides — the build steps and kits for one Build, and the pictures
 * that go with them. Read-only.
 *
 * A cut Build is read from the OnShape version it was cut at, so its guide is
 * what that Build was made with and never changes. A Draft is read from the
 * workspace (the BOM's one-minute cache).
 */

import { HttpError, badRequest } from '../middleware/httpError.js';
import { BuildField } from '../utils/buildConstants.js';
import { buildGuide } from '../utils/assemblyGuide.js';

const VERSION_LINK_RE = /\/documents\/([a-f0-9]{24})\/v\/([a-f0-9]{24})\/e\/([a-f0-9]{24})/i;
/** A BOM row path ("2.4.3") or the root step. */
const IMAGE_ID_RE = /^(root|\d{1,3}(\.\d{1,3}){0,7})$/;

/** A workspace guide (and its pictures) is reused this long. */
const LIVE_TTL_MS = 60 * 1000;
const LIVE_IMAGE_TTL_MS = 5 * 60 * 1000;
const MAX_IMAGES = 400;

export class AssemblyGuides {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   * @param {import('./bomService.js').BOMService} deps.bomService
   * @param {import('./epicService.js').EpicService} deps.epicService
   */
  constructor({ jiraClient, onshapeClient, bomService, epicService }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.bomService = bomService;
    this.epicService = epicService;
    /** where-key -> { at, promise of guide } */
    this._guides = new Map();
    /** image key -> { at, promise of Buffer } */
    this._images = new Map();
  }

  /** The Build's OnShape BOM to read: its cut version, else its Assembly's workspace. */
  async _whereOf(buildKey) {
    let build;
    try {
      build = await this.jiraClient.getIssue(buildKey, {
        fields: ['issuetype', BuildField.ASSEMBLY_LINK, BuildField.ONSHAPE_VERSION_LINK],
      });
    } catch (err) {
      if (err?.status === 404) throw new HttpError(404, `No ${buildKey} found`);
      throw err;
    }
    const f = build?.fields ?? {};
    if (f.issuetype?.name !== 'Build') throw badRequest(`"${buildKey}" is not a Build`);
    const assemblyKey = f[BuildField.ASSEMBLY_LINK];
    const assembly = assemblyKey ? await this.epicService.getEpicByKey(assemblyKey) : null;
    if (!assembly) throw new HttpError(404, 'This Build has no Assembly.');

    const version = VERSION_LINK_RE.exec(f[BuildField.ONSHAPE_VERSION_LINK] ?? '');
    const configuration = assembly.configuration ?? null;
    if (version) {
      return {
        assembly,
        where: { documentId: version[1].toLowerCase(), wvmType: 'v', wvmId: version[2].toLowerCase(), elementId: version[3].toLowerCase(), configuration },
      };
    }
    if (!assembly.documentId || !assembly.workspaceId || !assembly.elementId) {
      throw new HttpError(404, 'This Assembly has no OnShape link.');
    }
    return {
      assembly,
      where: { documentId: assembly.documentId, wvmType: 'w', wvmId: assembly.workspaceId, elementId: assembly.elementId, configuration },
    };
  }

  async _guideAt(where, assembly) {
    const key = [where.wvmType, where.documentId, where.wvmId, where.elementId, where.configuration ?? ''].join(':');
    const hit = this._guides.get(key);
    if (hit && (where.wvmType === 'v' || Date.now() - hit.at < LIVE_TTL_MS)) return hit.promise;
    const promise = this.bomService.getRawBOM(where).then((table) => {
      if (!table) throw new HttpError(502, 'OnShape returned no BOM for this Build.');
      return buildGuide(table, { documentId: where.documentId, name: assembly.name });
    });
    this._guides.set(key, { at: Date.now(), promise });
    promise.catch(() => this._guides.delete(key));
    return promise;
  }

  /**
   * @param {string} buildKey
   * @returns {Promise<{ source: 'version'|'workspace', steps: object[], kit: object[] }>}
   */
  async guide(buildKey) {
    const { assembly, where } = await this._whereOf(buildKey);
    const { steps, kit } = await this._guideAt(where, assembly);
    return { source: where.wvmType === 'v' ? 'version' : 'workspace', steps, kit };
  }

  /**
   * A picture for the guide: a step's sub-assembly, or one line's part, drawn
   * by OnShape (isometric). The id is a row path the guide itself handed out.
   *
   * @param {string} buildKey
   * @param {string} imageId
   * @param {{ large?: boolean }} [options]  A bigger drawing, for the enlarged view
   * @returns {Promise<{ image: Buffer, live: boolean }>}
   */
  async image(buildKey, imageId, { large = false } = {}) {
    if (!IMAGE_ID_RE.test(String(imageId ?? ''))) throw badRequest('Not a picture of this guide');
    const { assembly, where } = await this._whereOf(buildKey);
    const origin = imageId === 'root'
      ? { documentId: where.documentId, wvmType: where.wvmType, wvmId: where.wvmId, elementId: where.elementId, configuration: where.configuration }
      : (await this._guideAt(where, assembly)).origins.get(imageId);
    if (!origin) throw new HttpError(404, 'This guide has no such picture.');

    const live = origin.wvmType !== 'v';
    const key = [origin.documentId, origin.wvmType, origin.wvmId, origin.elementId, origin.partId ?? '', origin.configuration ?? '', large ? 'L' : ''].join(':');
    const hit = this._images.get(key);
    if (hit && (!live || Date.now() - hit.at < LIVE_IMAGE_TTL_MS)) return { image: await hit.promise, live };

    const draw = origin.partId
      ? this.onshapeClient.getPartImage(origin, large ? { width: 1200, height: 900 } : { width: 400, height: 300 })
      : this.onshapeClient.getAssemblyImage(origin, large ? { width: 1600, height: 1120 } : { width: 800, height: 560 });
    this._images.set(key, { at: Date.now(), promise: draw });
    draw.catch(() => this._images.delete(key));
    if (this._images.size > MAX_IMAGES) this._images.delete(this._images.keys().next().value);
    return { image: await draw, live };
  }
}
