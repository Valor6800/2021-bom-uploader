/**
 * Onshape Client — custom API client using axios + HMAC-SHA256 signing.
 *
 * Replaces all direct `request`-based Onshape HTTP calls with a modern
 * async/await client. Ported from ValorBOM.createSignature / genNonce.
 */

import crypto from 'node:crypto';
import axios from 'axios';

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
    return this._get(path, { multiLevel });
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
   * Export a STEP file for a part. Returns a Buffer.
   */
  async exportSTEP(documentId, workspaceId, elementId, partId) {
    const path = `/api/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${partId}/step/`;
    return this._getBinary(path);
  }

  /**
   * List versions already cut for a document, newest first per the Onshape
   * API's own ordering. Used to avoid re-cutting a version that already
   * exists for a Build.
   */
  async listVersions(documentId) {
    return this._get(`/api/documents/d/${documentId}/versions`);
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
   * @param {Array<{ propertyId: string, value: * }>} args.properties
   * @returns {Promise<object>} Updated metadata payload from Onshape
   */
  async updatePartMetadata({ documentId, workspaceId, elementId, partId, properties }) {
    if (!Array.isArray(properties) || properties.length === 0) {
      throw new OnshapeApiError(
        'updatePartMetadata requires a non-empty properties array',
        400,
        'updatePartMetadata',
      );
    }
    const path =
      `/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${partId}`;
    return this._post(path, { properties });
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
    const queryString = Object.keys(params).length
      ? new URLSearchParams(params).toString()
      : '';
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
   * Wrap axios errors into OnshapeApiError.
   * NEVER includes the secret key in the error message.
   */
  _wrapError(err, endpoint) {
    const status = err?.response?.status ?? 0;

    // Auth failures get a clear, descriptive message
    if (status === 401 || status === 403) {
      return new OnshapeApiError(
        'Onshape authentication failed — verify ONSHAPE_ACCESS and ONSHAPE_SECRET env vars and check for clock drift',
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
