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
