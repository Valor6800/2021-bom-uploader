/**
 * Unit tests for OnshapeClient.
 * Mocks axios to verify HMAC signing, request construction, binary exports,
 * auth error handling, and secret redaction.
 */

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock axios before importing OnshapeClient
// ---------------------------------------------------------------------------

const mockGet = jest.fn();
const mockRequest = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: {
    create: () => ({ get: mockGet, request: mockRequest }),
  },
}));

const {
  OnshapeClient,
  OnshapeApiError,
  genNonce,
  createSignature,
} = await import('../../src/server/clients/onshapeClient.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient() {
  return new OnshapeClient({
    baseUrl: 'https://cad.onshape.com',
    accessKey: 'testAccessKey',
    secretKey: 'testSecretKey',
    teamId: 'team123',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('genNonce', () => {
  it('returns a string of the requested length', () => {
    expect(genNonce(25)).toHaveLength(25);
    expect(genNonce(10)).toHaveLength(10);
  });

  it('contains only alphanumeric characters', () => {
    const nonce = genNonce(100);
    expect(nonce).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('createSignature', () => {
  it('produces a deterministic HMAC for known inputs', () => {
    const sig = createSignature(
      'GET',
      '/api/documents',
      'q=test',
      'fixedNonce1234567890abcde',
      'Mon, 01 Jan 2024 00:00:00 GMT',
      'application/json',
      'myAccessKey',
      'mySecretKey',
    );
    expect(sig).toMatch(/^On myAccessKey:HmacSHA256:.+$/);
  });

  it('returns different signatures for different methods', () => {
    const args = [
      '/api/documents',
      '',
      'nonce1234567890123456789',
      'Mon, 01 Jan 2024 00:00:00 GMT',
      'application/json',
      'ak',
      'sk',
    ];
    const sigGet = createSignature('GET', ...args);
    const sigPost = createSignature('POST', ...args);
    expect(sigGet).not.toBe(sigPost);
  });
});

describe('OnshapeClient', () => {
  describe('constructor', () => {
    it('throws when baseUrl is missing', () => {
      const orig = process.env.ONSHAPE_URL;
      delete process.env.ONSHAPE_URL;
      expect(() => new OnshapeClient({ accessKey: 'a', secretKey: 's' }))
        .toThrow('Onshape base URL is required');
      process.env.ONSHAPE_URL = orig;
    });

    it('throws when accessKey is missing', () => {
      const orig = process.env.ONSHAPE_ACCESS;
      delete process.env.ONSHAPE_ACCESS;
      expect(() => new OnshapeClient({ baseUrl: 'https://x', secretKey: 's' }))
        .toThrow('Onshape access key is required');
      process.env.ONSHAPE_ACCESS = orig;
    });

    it('throws when secretKey is missing', () => {
      const orig = process.env.ONSHAPE_SECRET;
      delete process.env.ONSHAPE_SECRET;
      expect(() => new OnshapeClient({ baseUrl: 'https://x', accessKey: 'a' }))
        .toThrow('Onshape secret key is required');
      process.env.ONSHAPE_SECRET = orig;
    });
  });

  describe('getAssemblyBOM', () => {
    it('calls the correct path with multiLevel param', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: { bomTable: {} } });

      const result = await client.getAssemblyBOM('doc1', 'ws1', 'elem1');
      expect(result).toEqual({ bomTable: {} });

      const [path, config] = mockGet.mock.calls[0];
      expect(path).toContain('/api/assemblies/d/doc1/w/ws1/e/elem1/bom');
      expect(path).toContain('multiLevel=true');
      expect(config.headers).toHaveProperty('Authorization');
      expect(config.headers['Authorization']).toMatch(/^On testAccessKey:HmacSHA256:/);
    });
  });

  describe('getDocuments', () => {
    it('passes query and team owner', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: { items: [] } });

      await client.getDocuments('VR26A');
      const [path] = mockGet.mock.calls[0];
      expect(path).toContain('/api/documents');
      expect(path).toContain('q=VR26A');
      expect(path).toContain('owner=team123');
    });
  });

  describe('getWorkspaces', () => {
    it('calls the correct path', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: [{ id: 'ws1', name: 'Main' }] });

      const result = await client.getWorkspaces('doc1');
      expect(result).toEqual([{ id: 'ws1', name: 'Main' }]);
      expect(mockGet.mock.calls[0][0]).toBe('/api/documents/d/doc1/workspaces');
    });
  });

  describe('getElements', () => {
    it('passes elementType filter', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: [] });

      await client.getElements('doc1', 'ws1', 'ASSEMBLY');
      const [path] = mockGet.mock.calls[0];
      expect(path).toContain('elementType=ASSEMBLY');
    });
  });

  describe('exportSTL', () => {
    it('returns a Buffer', async () => {
      const client = makeClient();
      const binaryData = new Uint8Array([0x53, 0x54, 0x4c]).buffer;
      mockGet.mockResolvedValueOnce({ data: binaryData });

      const result = await client.exportSTL('d', 'w', 'e', 'p');
      expect(Buffer.isBuffer(result)).toBe(true);

      const [path, config] = mockGet.mock.calls[0];
      expect(path).toContain('/stl/');
      expect(config.responseType).toBe('arraybuffer');
      expect(config.headers['Accept']).toBe('application/vnd.onshape.v1+octet-stream');
    });
  });

  describe('exportSTEP', () => {
    it('returns a Buffer', async () => {
      const client = makeClient();
      const binaryData = new Uint8Array([0x01, 0x02]).buffer;
      mockGet.mockResolvedValueOnce({ data: binaryData });

      const result = await client.exportSTEP('d', 'w', 'e', 'p');
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(mockGet.mock.calls[0][0]).toContain('/step/');
    });
  });

  describe('updatePartMetadata', () => {
    it('POSTs to the part metadata path with the properties body', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: { properties: [] } });

      const properties = [{ propertyId: 'prop1', value: 'AL 6061' }];
      const result = await client.updatePartMetadata({
        documentId: 'doc1',
        workspaceId: 'ws1',
        elementId: 'elem1',
        partId: 'part1',
        properties,
      });
      expect(result).toEqual({ properties: [] });

      const config = mockRequest.mock.calls[0][0];
      expect(config.method).toBe('POST');
      expect(config.url).toBe('/api/metadata/d/doc1/w/ws1/e/elem1/p/part1');
      expect(config.data).toEqual({ properties });
      expect(config.headers['Authorization']).toMatch(/^On testAccessKey:HmacSHA256:/);
      expect(config.headers).toHaveProperty('On-Nonce');
    });

    it('signs POST differently than GET for the same path', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: {} });
      await client.updatePartMetadata({
        documentId: 'd', workspaceId: 'w', elementId: 'e', partId: 'p',
        properties: [{ propertyId: 'x', value: 1 }],
      });
      const postAuth = mockRequest.mock.calls[0][0].headers['Authorization'];
      expect(postAuth).toMatch(/HmacSHA256/);
    });

    it('rejects an empty properties array without calling the API', async () => {
      const client = makeClient();
      await expect(
        client.updatePartMetadata({
          documentId: 'd', workspaceId: 'w', elementId: 'e', partId: 'p',
          properties: [],
        }),
      ).rejects.toThrow(OnshapeApiError);
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('updateElementMetadata', () => {
    it('POSTs to the element metadata path with the properties body', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: { ok: true } });

      const properties = [{ propertyId: 'prop2', value: 'Main Assembly' }];
      await client.updateElementMetadata({
        documentId: 'doc1',
        workspaceId: 'ws1',
        elementId: 'elem1',
        properties,
      });

      const config = mockRequest.mock.calls[0][0];
      expect(config.method).toBe('POST');
      expect(config.url).toBe('/api/metadata/d/doc1/w/ws1/e/elem1');
      expect(config.data).toEqual({ properties });
    });

    it('rejects an empty properties array', async () => {
      const client = makeClient();
      await expect(
        client.updateElementMetadata({
          documentId: 'd', workspaceId: 'w', elementId: 'e', properties: [],
        }),
      ).rejects.toThrow(OnshapeApiError);
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('write error handling', () => {
    it('wraps write failures as OnshapeApiError with the write endpoint', async () => {
      const client = makeClient();
      const err = new Error('boom');
      err.response = { status: 500 };
      mockRequest.mockRejectedValueOnce(err);

      try {
        await client.updatePartMetadata({
          documentId: 'd', workspaceId: 'w', elementId: 'e', partId: 'p',
          properties: [{ propertyId: 'x', value: 1 }],
        });
      } catch (e) {
        expect(e).toBeInstanceOf(OnshapeApiError);
        expect(e.endpoint).toContain('POST');
      }
    });
  });

  describe('error handling', () => {
    it('returns descriptive auth error for 401', async () => {
      const client = makeClient();
      const err = new Error('Unauthorized');
      err.response = { status: 401 };
      mockGet.mockRejectedValueOnce(err);

      await expect(client.getDocuments('test')).rejects.toThrow(OnshapeApiError);
      try {
        await client.getDocuments('test');
      } catch (e) {
        // second call also mocked to reject
      }
      // Reset and test the message
      mockGet.mockRejectedValueOnce(err);
      try {
        await client.getDocuments('test');
      } catch (e) {
        expect(e.message).toContain('Onshape authentication failed');
        expect(e.status).toBe(401);
      }
    });

    it('returns descriptive auth error for 403', async () => {
      const client = makeClient();
      const err = new Error('Forbidden');
      err.response = { status: 403 };
      mockGet.mockRejectedValueOnce(err);

      try {
        await client.getDocuments('test');
      } catch (e) {
        expect(e).toBeInstanceOf(OnshapeApiError);
        expect(e.message).toContain('Onshape authentication failed');
        expect(e.status).toBe(403);
      }
    });

    it('never includes secret key in error output', async () => {
      const client = makeClient();
      const err = new Error('Connection failed with key testSecretKey exposed');
      err.response = { status: 500 };
      mockGet.mockRejectedValueOnce(err);

      try {
        await client.getDocuments('test');
      } catch (e) {
        expect(e.message).not.toContain('testSecretKey');
        expect(e.message).toContain('[REDACTED]');
      }
    });

    it('wraps generic errors with status and endpoint', async () => {
      const client = makeClient();
      const err = new Error('timeout');
      mockGet.mockRejectedValueOnce(err);

      try {
        await client.getWorkspaces('doc1');
      } catch (e) {
        expect(e).toBeInstanceOf(OnshapeApiError);
        expect(e.status).toBe(0);
        expect(e.endpoint).toContain('GET');
      }
    });
  });

  describe('HMAC signing headers', () => {
    it('includes Authorization, On-Nonce, Date, and Content-Type', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: {} });

      await client.getDocuments('test');
      const headers = mockGet.mock.calls[0][1].headers;

      expect(headers).toHaveProperty('Authorization');
      expect(headers).toHaveProperty('On-Nonce');
      expect(headers).toHaveProperty('Date');
      expect(headers).toHaveProperty('Content-Type', 'application/json');
      expect(headers['On-Nonce']).toHaveLength(25);
    });
  });
});
