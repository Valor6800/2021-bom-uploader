/**
 * Onshape Client — custom API client using axios + HMAC-SHA256 signing.
 *
 * Replaces all direct `request`-based Onshape HTTP calls with a modern
 * async/await client. Ported from ValorBOM.createSignature / genNonce.
 */

import crypto from 'node:crypto';
import axios from 'axios';
import { isNetworkError } from '../utils/upstreamError.js';
import { recordOnshapeCall } from '../utils/onshapeUsage.js';

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

export class OnshapeApiError extends Error {
  /**
   * @param {string} message  Human-readable description (never contains secrets)
   * @param {number} status   HTTP status code (0 for network errors)
   * @param {string} endpoint The Onshape endpoint that failed
   */
  constructor(message, status, endpoint) {
    super(message);
    this.name = 'OnshapeApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ---------------------------------------------------------------------------
// HMAC helpers (ported from ValorBOM)
// ---------------------------------------------------------------------------

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a random alphanumeric nonce of the given length.
 * @param {number} length
 * @returns {string}
 */
export function genNonce(length = 25) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return result;
}

/**
 * Build the Onshape HMAC-SHA256 Authorization header value.
 *
 * @param {string} method      HTTP method (GET, POST, …)
 * @param {string} urlPath     URL pathname (e.g. /api/documents)
 * @param {string} urlQuery    Query string without leading "?" (or empty)
 * @param {string} nonce       25-char nonce
 * @param {string} authDate    UTC date string
 * @param {string} contentType Content-Type header value
 * @param {string} accessKey   Onshape API access key
 * @param {string} secretKey   Onshape API secret key
 * @returns {string}
 */
export function createSignature(method, urlPath, urlQuery, nonce, authDate, contentType, accessKey, secretKey) {
  const str = (
    method + '\n' +
    nonce + '\n' +
    authDate + '\n' +
    contentType + '\n' +
    urlPath + '\n' +
    urlQuery + '\n'
  ).toLowerCase();

  const hmac = crypto
    .createHmac('sha256', secretKey)
    .update(str)
    .digest('base64');

  return 'On ' + accessKey + ':HmacSHA256:' + hmac;
}

// ---------------------------------------------------------------------------
// OnshapeClient
// ---------------------------------------------------------------------------

/**
 * OnShape's isometric view: the camera at the front-right-top corner (+x, -y,
 * +z) looking at the part, z up. The rows are the camera's right, up and back
 * directions.
 */
const ISO_VIEW_MATRIX = (() => {
  const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const back = unit([1, -1, 1]);
  const right = unit(cross([0, 0, 1], back));
  const up = cross(back, right);
  return [right, up, back].flatMap((row) => [...row, 0]).join(',');
})();

/** A part's shape from OnShape's mass properties: each value's first entry (the rest are bounds). */
function shapeOf(body) {
  return {
    volume: body.volume?.[0] ?? 0,
    periphery: body.periphery?.[0] ?? 0,
    mass: body.mass?.[0] ?? 0,
    principalInertia: (body.principalInertia ?? []).slice(0, 3),
  };
}

export class OnshapeClient {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl]   Onshape base URL (defaults to ONSHAPE_URL env)
   * @param {string} [options.accessKey] API access key (defaults to ONSHAPE_ACCESS env)
   * @param {string} [options.secretKey] API secret key (defaults to ONSHAPE_SECRET env)
   * @param {string} [options.teamId]    Team ID (defaults to ONSHAPE_TEAM env)
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? process.env.ONSHAPE_URL ?? process.env.ONSHAPE_BASE_URL;
    this.accessKey = options.accessKey ?? process.env.ONSHAPE_ACCESS ?? process.env.API_KEY;
    this.secretKey = options.secretKey ?? process.env.ONSHAPE_SECRET ?? process.env.SECRET_KEY;
    this.teamId = options.teamId ?? process.env.ONSHAPE_TEAM ?? process.env.ONSHAPE_TEAM_ID;
    /** How long an export is left before it is first checked, and between checks (each check is a call). */
    this.exportWaitMs = options.exportWaitMs ?? 10_000;

    if (!this.baseUrl) throw new Error('Onshape base URL is required (set ONSHAPE_URL env var)');
    if (!this.accessKey) throw new Error('Onshape access key is required (set ONSHAPE_ACCESS env var)');
    if (!this.secretKey) throw new Error('Onshape secret key is required (set ONSHAPE_SECRET env var)');

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30_000,
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Fetch the BOM table for an assembly.
   */
  async getAssemblyBOM(documentId, workspaceId, elementId, options = {}) {
    const multiLevel = options.multiLevel !== false;
    const path = `/api/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/bom`;
    // A configured assembly's BOM is for one configuration; without one OnShape answers for the default.
    return this._get(path, { multiLevel, ...(options.configuration ? { configuration: options.configuration } : {}) });
  }

  /**
   * The BOM of an assembly as it was when a version was cut. A version never
   * changes, so the answer for one version never changes either.
   */
  async getAssemblyBOMAtVersion(documentId, versionId, elementId, { configuration } = {}) {
    const path = `/api/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/bom`;
    return this._get(path, { multiLevel: true, ...(configuration ? { configuration } : {}) });
  }

  /**
   * A part's shape in numbers: volume, surface area (`periphery`), mass and
   * principal moments of inertia. None of these depend on where the part sits
   * in its Part Studio, so the same shape gives the same numbers.
   *
   * @param {object} args
   * @param {string} args.documentId
   * @param {'w'|'v'} args.wvmType  Workspace or version
   * @param {string} args.wvmId
   * @param {string} args.elementId  The Part Studio
   * @param {string} args.partId
   * @param {string} [args.configuration]
   * @returns {Promise<{ volume: number, periphery: number, mass: number, principalInertia: number[] }>}
   */
  /**
   * `getPartShape` for several parts of one Part Studio, in one call.
   *
   * @param {object} studio   `{ documentId, wvmType, wvmId, elementId, configuration? }`
   * @param {string[]} partIds
   * @returns {Promise<Map<string, object>>}  part id -> shape; a part OnShape doesn't list is left out
   */
  async getPartStudioShapes({ documentId, wvmType, wvmId, elementId, configuration }, partIds) {
    const path = `/api/partstudios/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}/massproperties`;
    const params = { partId: partIds, massAsGroup: false };
    if (configuration) params.configuration = configuration;
    const res = await this._get(path, params);
    const out = new Map();
    for (const [id, body] of Object.entries(res?.bodies ?? {})) out.set(id, shapeOf(body));
    return out;
  }

  async getPartShape({ documentId, wvmType, wvmId, elementId, partId, configuration }) {
    const path = `/api/parts/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}`
      + `/partid/${encodeURIComponent(partId)}/massproperties`;
    const res = await this._get(path, configuration ? { configuration } : {});
    const body = res?.bodies?.[partId] ?? Object.values(res?.bodies ?? {})[0];
    if (!body) {
      throw new OnshapeApiError('OnShape returned no mass properties for the part', 502, path);
    }
    return shapeOf(body);
  }

  /**
   * Search for Onshape documents.
   */
  async getDocuments(query, options = {}) {
    const teamId = options.teamId ?? this.teamId;
    const params = {
      q: query,
      filter: 9,
      sortColumn: 'createdAt',
      sortOrder: 'desc',
    };
    if (teamId) params.owner = teamId;
    return this._get('/api/documents', params);
  }

  /**
   * Get workspaces for a document.
   */
  async getWorkspaces(documentId) {
    return this._get(`/api/documents/d/${documentId}/workspaces`);
  }

  /**
   * Get elements for a document/workspace, optionally filtered by type.
   */
  async getElements(documentId, workspaceId, elementType) {
    const params = {};
    if (elementType) params.elementType = elementType;
    return this._get(`/api/documents/d/${documentId}/w/${workspaceId}/elements`, params);
  }

  /**
   * Export an STL file for a part. Returns a Buffer.
   */
  async exportSTL(documentId, workspaceId, elementId, partId) {
    const path = `/api/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${partId}/stl/`;
    return this._getBinary(path, { grouping: true, scale: '1.0', units: 'millimeter', mode: 'binary' });
  }

  /**
   * Export a STEP file for a part in a workspace. Returns a Buffer.
   */
  async exportSTEP(documentId, workspaceId, elementId, partId, configuration) {
    return this.exportPartStep({
      documentId, wvmType: 'w', wvmId: workspaceId, elementId, partId, configuration,
    });
  }

  /**
   * Start a STEP export of some parts of one Part Studio. Each part comes
   * back as its own file (in a zip when there are several: `exportResult`).
   *
   * @param {object} studio  `{ documentId, wvmType, wvmId, elementId, configuration? }`
   * @param {string[]} partIds
   * @returns {Promise<string>}  The translation's id, for `exportResult`
   */
  async startStepExport({ documentId, wvmType, wvmId, elementId, configuration }, partIds) {
    const path = `/api/partstudios/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}/translations`;
    // partIds is one string (not a list); the configuration is a query parameter.
    const job = await this._post(
      path,
      { formatName: 'STEP', partIds: partIds.join(','), grouping: false, storeInDocument: false },
      configuration ? { configuration } : {},
    );
    return job.id;
  }

  /**
   * Wait for a translation and download what it made. Nothing waits on an
   * export, so it is checked rarely: first after `firstCheckMs`, then every
   * `everyMs` (an export takes a few seconds; each check is an API call).
   *
   * @param {string} documentId
   * @param {string} translationId
   * @returns {Promise<Buffer>}  One file, or a zip of them
   */
  async exportResult(documentId, translationId, {
    firstCheckMs = this.exportWaitMs, everyMs = this.exportWaitMs, timeoutMs = 180_000,
  } = {}) {
    const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    const deadline = Date.now() + timeoutMs;
    await wait(firstCheckMs);
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const state = await this._get(`/api/translations/${translationId}`);
      if (state.requestState === 'DONE' && state.resultExternalDataIds?.length) {
        return this._getBinary(`/api/documents/d/${documentId}/externaldata/${state.resultExternalDataIds[0]}`);
      }
      if (state.requestState !== 'ACTIVE') {
        throw new OnshapeApiError(
          `OnShape could not export STEP (${state.failureReason ?? state.requestState})`,
          502,
          `translation ${translationId}`,
        );
      }
      if (Date.now() > deadline) {
        throw new OnshapeApiError('OnShape took too long to export STEP', 504, `translation ${translationId}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await wait(everyMs);
    }
  }

  /**
   * One part's STEP: an export of it alone, waited for as `exportResult` does.
   * @returns {Promise<Buffer>}
   */
  async exportPartStep(origin, options) {
    const id = await this.startStepExport(origin, [origin.partId]);
    return this.exportResult(origin.documentId, id, options);
  }


  /**
   * A picture of one part, from the isometric corner (front, right, top;
   * z up) with its edges drawn, framed to fill the image. OnShape renders it,
   * in the part's own colour, in about half a second.
   *
   * @param {object} origin  `{ documentId, wvmType, wvmId, elementId, partId, configuration? }`
   * @param {{ width?: number, height?: number }} [size]  Pixels
   * @returns {Promise<Buffer>}  A PNG
   */
  async getPartImage(origin, { width = 800, height = 600 } = {}) {
    const { documentId, wvmType, wvmId, elementId, partId, configuration } = origin;
    return this._isoImage(
      `/api/parts/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}/partid/${encodeURIComponent(partId)}/shadedviews`,
      { width, height, configuration },
    );
  }

  /**
   * A picture of a whole assembly, in the same isometric view as a part's.
   * An assembly takes several seconds to draw.
   *
   * @param {object} origin  `{ documentId, wvmType, wvmId, elementId, configuration? }` (the assembly's tab)
   * @param {{ width?: number, height?: number }} [size]  Pixels
   * @returns {Promise<Buffer>}  A PNG
   */
  async getAssemblyImage(origin, { width = 1000, height = 700 } = {}) {
    const { documentId, wvmType, wvmId, elementId, configuration } = origin;
    return this._isoImage(
      `/api/assemblies/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}/shadedviews`,
      { width, height, configuration },
    );
  }

  async _isoImage(path, { width, height, configuration }) {
    const res = await this._get(path, {
      viewMatrix: ISO_VIEW_MATRIX,
      outputWidth: width,
      outputHeight: height,
      pixelSize: 0, // 0 fits the subject to the image
      edges: 'show',
      ...(configuration ? { configuration } : {}),
    });
    if (!res?.images?.[0]) {
      throw new OnshapeApiError('OnShape returned no image', 502, path);
    }
    return Buffer.from(res.images[0], 'base64');
  }

  /**
   * Every body in a Part Studio, with its faces, edges and vertices (metres).
   * A body's id is its part id.
   *
   * @param {object} origin  `{ documentId, wvmType, wvmId, elementId, configuration? }`
   * @returns {Promise<object[]>}
   */
  async getBodyDetails({ documentId, wvmType, wvmId, elementId, configuration }) {
    const path = `/api/partstudios/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}/bodydetails`;
    const res = await this._get(path, configuration ? { configuration } : {});
    return res.bodies ?? [];
  }

  /**
   * Run a read-only FeatureScript function in a Part Studio.
   *
   * @param {object} origin  As for `getBodyDetails`
   * @param {string} script  `function(context is Context, queries) { … }`
   * @returns {Promise<object>}  OnShape's response (`result` holds typed values)
   */
  async evalFeatureScript({ documentId, wvmType, wvmId, elementId, configuration }, script) {
    const path = `/api/partstudios/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}/featurescript`;
    return this._post(path, { script, queries: [] }, configuration ? { configuration } : {});
  }

  /**
   * Points along curved edges, for outlines that aren't lines or circles.
   *
   * @param {object} origin   As for `getBodyDetails`
   * @param {string[]} edgeIds
   * @returns {Promise<Map<string, number[][]>>}  edge id -> points (metres)
   */
  async getTessellatedEdges({ documentId, wvmType, wvmId, elementId, configuration }, edgeIds) {
    const path = `/api/partstudios/d/${documentId}/${wvmType}/${wvmId}/e/${elementId}/tessellatededges`;
    const params = { edgeId: edgeIds };
    if (configuration) params.configuration = configuration;
    const res = await this._get(path, params);
    const out = new Map();
    for (const body of res ?? []) {
      for (const edge of body.edges ?? []) out.set(edge.id, edge.vertices);
    }
    return out;
  }

  /**
   * List versions already cut for a document, newest first per the Onshape
   * API's own ordering. Used to avoid re-cutting a version that already
   * exists for a Build.
   */
  async listVersions(documentId) {
    return this._get(`/api/documents/d/${documentId}/versions`);
  }

  /**
   * Read the metadata (properties) of an element (tab), e.g. an assembly's
   * native Name, Part number, Revision, and Project fields.
   *
   * Response shape: `{ elementId, elementType, properties: [{ name,
   * propertyId, value, valueType, editable, ... }], ... }`.
   *
   * @see https://onshape-public.github.io/docs/api-adv/metadata/
   */
  async getElementMetadata(documentId, workspaceId, elementId, configuration) {
    return this._get(
      `/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}`,
      configuration ? { configuration } : {},
    );
  }

  // -----------------------------------------------------------------------
  // Write operations
  // -----------------------------------------------------------------------

  /**
   * Cut a version — an immutable snapshot of a workspace. This is what
   * happens when a Build is cut: the version's own id gets written back onto
   * the Build's Onshape Version Link field (Sheet 02/03 of the plan).
   *
   * @param {string} documentId
   * @param {string} workspaceId
   * @param {object} args
   * @param {string} args.name          The Build's own key, so the version is
   *   identifiable from Onshape's version list without cross-referencing Jira
   * @param {string} [args.description]  Free text; this plan puts a link back
   *   to the Jira issue here
   * @returns {Promise<{ id: string, name: string }>}
   */
  async createVersion(documentId, workspaceId, { name, description } = {}) {
    const path = `/api/documents/d/${documentId}/versions`;
    return this._post(path, {
      documentId,
      workspaceId,
      name,
      description: description ?? '',
    });
  }

  /**
   * Fork a new workspace from a specific version — what happens when a
   * Revision starts. The prior revision's workspace and version history stay
   * exactly as they were; the new workspace moves forward independently.
   *
   * UNVERIFIED REQUEST SHAPE: Onshape's own API Explorer (the authoritative
   * source for this endpoint's body) requires a logged-in session and isn't
   * reachable from here, and the public docs pages don't spell out the
   * branch-from-version fields. `branchedFrom.vid` is a reasonable guess
   * based on Onshape's version-id terminology elsewhere in the API, not a
   * confirmed field name — verify against the API Explorer
   * (https://cad.onshape.com/glassworks/explorer/#/Document) before this
   * runs against anything that matters.
   *
   * @param {string} documentId
   * @param {string} fromVersionId
   * @param {object} args
   * @param {string} args.name  The new Revision's own key
   * @returns {Promise<{ id: string, name: string }>}
   */
  async createBranch(documentId, fromVersionId, { name } = {}) {
    const path = `/api/documents/d/${documentId}/workspaces`;
    return this._post(path, {
      name,
      documentId,
      isBranchedFrom: true,
      branchedFrom: { vid: fromVersionId },
    });
  }

  /**
   * Update metadata (custom properties) for a part.
   *
   * Onshape metadata is written by property ID. Each entry supplies the
   * target `propertyId` and its new `value`. Property IDs are discoverable
   * via the corresponding metadata GET endpoint.
   *
   * @see https://onshape-public.github.io/docs/api-adv/metadata/
   *
   * @param {object} args
   * @param {string} args.documentId
   * @param {string} args.workspaceId
   * @param {string} args.elementId
   * @param {string} args.partId
   * @param {string} [args.configuration]  The part's configuration, when its
   *   Part Studio is configured (a configured part's metadata is not found without it)
   * @param {Array<{ propertyId: string, value: * }>} args.properties
   * @returns {Promise<object>} Updated metadata payload from Onshape
   */
  /**
   * Write properties to several parts of one Part Studio in one call.
   *
   * @param {object} studio  `{ documentId, workspaceId, elementId, configuration? }`
   * @param {{ partId: string, properties: { propertyId: string, value: string }[] }[]} items
   * @returns {Promise<object>}  OnShape's answer, with a status per property
   */
  async updatePartsMetadata({ documentId, workspaceId, elementId, configuration }, items) {
    const path = `/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}`;
    const body = {
      jsonType: 'metadata-element',
      items: items.map(({ partId, properties }) => ({
        href: `${this.baseUrl}/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${encodeURIComponent(partId)}`,
        properties,
      })),
    };
    return this._post(path, body, configuration ? { configuration } : {});
  }

  async updatePartMetadata({ documentId, workspaceId, elementId, partId, configuration, properties }) {
    if (!Array.isArray(properties) || properties.length === 0) {
      throw new OnshapeApiError(
        'updatePartMetadata requires a non-empty properties array',
        400,
        'updatePartMetadata',
      );
    }
    const path =
      `/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${encodeURIComponent(partId)}`;
    return this._post(path, { properties }, configuration ? { configuration } : {});
  }

  /**
   * Update metadata (custom properties) for an element (tab), e.g. the
   * assembly-level properties. Same body shape as part metadata.
   *
   * @param {object} args
   * @param {string} args.documentId
   * @param {string} args.workspaceId
   * @param {string} args.elementId
   * @param {Array<{ propertyId: string, value: * }>} args.properties
   * @returns {Promise<object>}
   */
  async updateElementMetadata({ documentId, workspaceId, elementId, properties }) {
    if (!Array.isArray(properties) || properties.length === 0) {
      throw new OnshapeApiError(
        'updateElementMetadata requires a non-empty properties array',
        400,
        'updateElementMetadata',
      );
    }
    const path = `/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}`;
    return this._post(path, { properties });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Perform a signed GET request returning parsed JSON.
   */
  async _get(path, params = {}) {
    const endpoint = `GET ${path}`;
    recordOnshapeCall(endpoint);
    try {
      const { fullPath, queryString } = this._buildUrl(path, params);
      const headers = this._signHeaders('GET', path, queryString, 'application/json');
      const res = await this.http.get(fullPath, { headers });
      return res.data;
    } catch (err) {
      throw this._wrapError(err, endpoint);
    }
  }

  /**
   * Perform a signed GET request returning a Buffer (for binary exports).
   */
  async _getBinary(path, params = {}) {
    const endpoint = `GET (binary) ${path}`;
    recordOnshapeCall(endpoint);
    try {
      const { fullPath, queryString } = this._buildUrl(path, params);
      const headers = this._signHeaders('GET', path, queryString, 'application/json');
      headers['Accept'] = 'application/vnd.onshape.v1+octet-stream';
      const res = await this.http.get(fullPath, {
        headers,
        responseType: 'arraybuffer',
      });
      return Buffer.from(res.data);
    } catch (err) {
      throw this._wrapError(err, endpoint);
    }
  }

  /**
   * Perform a signed POST request with a JSON body, returning parsed JSON.
   */
  async _post(path, body = {}, params = {}) {
    return this._write('POST', path, body, params);
  }

  /**
   * Perform a signed PATCH request with a JSON body, returning parsed JSON.
   */
  async _patch(path, body = {}, params = {}) {
    return this._write('PATCH', path, body, params);
  }

  /**
   * Shared implementation for signed write requests (POST/PATCH).
   *
   * The Onshape signature covers method, path, query, nonce, date, and
   * content-type — NOT the body — so a JSON body is sent alongside the same
   * signed headers used for reads.
   */
  async _write(method, path, body, params) {
    const endpoint = `${method} ${path}`;
    recordOnshapeCall(endpoint);
    try {
      const { fullPath, queryString } = this._buildUrl(path, params);
      const headers = this._signHeaders(method, path, queryString, 'application/json');
      const res = await this.http.request({
        method,
        url: fullPath,
        headers,
        data: body,
      });
      return res.data;
    } catch (err) {
      throw this._wrapError(err, endpoint);
    }
  }

  /**
   * Build the full URL path with query string, keeping the query string
   * consistent between what's signed and what's sent to Onshape.
   */
  _buildUrl(path, params) {
    // A list parameter is sent as one entry per value (edgeId=a&edgeId=b).
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach((v) => search.append(name, v));
      else search.append(name, value);
    }
    const queryString = search.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;
    return { fullPath, queryString };
  }

  /**
   * Build signed headers for an Onshape request.
   */
  _signHeaders(method, path, queryString, contentType) {
    const nonce = genNonce(25);
    const authDate = new Date().toUTCString();

    const signature = createSignature(
      method,
      path,
      queryString,
      nonce,
      authDate,
      contentType,
      this.accessKey,
      this.secretKey,
    );

    return {
      'Content-Type': contentType,
      'Authorization': signature,
      'On-Nonce': nonce,
      'Date': authDate,
    };
  }

  /**
   * Wrap axios errors into OnshapeApiError. Anything else (a TypeError from
   * our own code) is returned unchanged, so it surfaces as ValorBOM's own
   * error, not as OnShape's.
   * NEVER includes the secret key in the error message.
   */
  _wrapError(err, endpoint) {
    const status = err?.response?.status ?? 0;
    if (!status && !isNetworkError(err)) return err;

    // Auth failures get a clear, descriptive message
    if (status === 401) {
      return new OnshapeApiError(
        'Onshape authentication failed — verify ONSHAPE_ACCESS and ONSHAPE_SECRET env vars and check for clock drift',
        status,
        endpoint,
      );
    }

    // Signed in, but the API key's scopes or the document's sharing don't
    // allow this request (e.g. a read-only key asked to create a version).
    if (status === 403) {
      return new OnshapeApiError(
        'Onshape refused access — the API key may lack write scope, or the document is not shared for this action',
        status,
        endpoint,
      );
    }

    // Sanitize: strip any accidental secret leakage from the message
    let msg = err?.message ?? String(err);
    if (this.secretKey && msg.includes(this.secretKey)) {
      msg = msg.replaceAll(this.secretKey, '[REDACTED]');
    }

    return new OnshapeApiError(msg, status, endpoint);
  }
}
