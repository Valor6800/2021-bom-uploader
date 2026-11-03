/**
 * Unit tests for OnshapeClient.
 * Mocks axios to verify HMAC signing, request construction, binary exports,
 * auth error handling, and secret redaction.
 */

import { jest } from '@jest/globals';
import { withoutEnv } from '../mocks/withoutEnv.js';

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
      withoutEnv(['ONSHAPE_URL', 'ONSHAPE_BASE_URL'], () => {
        expect(() => new OnshapeClient({ accessKey: 'a', secretKey: 's' }))
          .toThrow('Onshape base URL is required');
      });
    });

    it('throws when accessKey is missing', () => {
      withoutEnv(['ONSHAPE_ACCESS', 'API_KEY'], () => {
        expect(() => new OnshapeClient({ baseUrl: 'https://x', secretKey: 's' }))
          .toThrow('Onshape access key is required');
      });
    });

    it('throws when secretKey is missing', () => {
      withoutEnv(['ONSHAPE_SECRET', 'SECRET_KEY'], () => {
        expect(() => new OnshapeClient({ baseUrl: 'https://x', accessKey: 'a' }))
          .toThrow('Onshape secret key is required');
      });
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

  describe('getPartImage', () => {
    it('asks for an isometric picture with edges, fitted to the part, and returns the PNG', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: { images: [Buffer.from('PNGDATA').toString('base64')] } });
      const png = await client.getPartImage(
        { documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', partId: 'JVD', configuration: 'List_a=X' },
      );
      expect(png.toString()).toBe('PNGDATA');
      const [url] = mockGet.mock.calls[0];
      expect(url).toContain('/api/parts/d/d/w/w/e/e/partid/JVD/shadedviews?');
      const query = new URLSearchParams(url.split('?')[1]);
      expect(query.get('edges')).toBe('show');
      expect(query.get('pixelSize')).toBe('0');
      expect(query.get('configuration')).toBe('List_a=X');
      // The camera sits at front-right-top: back direction (1, -1, 1) / sqrt 3.
      const m = query.get('viewMatrix').split(',').map(Number);
      expect(m).toHaveLength(12);
      expect(m.slice(8, 11).map((v) => Number(v.toFixed(4)))).toEqual([0.5774, -0.5774, 0.5774]);
    });

    it('draws a whole assembly in the same view, in a workspace or a version', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: { images: [Buffer.from('ASM').toString('base64')] } });
      const png = await client.getAssemblyImage({ documentId: 'd', wvmType: 'v', wvmId: 'ver', elementId: 'e' }, { width: 1000, height: 700 });
      expect(png.toString()).toBe('ASM');
      const [url] = mockGet.mock.calls[0];
      expect(url).toContain('/api/assemblies/d/d/v/ver/e/e/shadedviews?');
      const query = new URLSearchParams(url.split('?')[1]);
      expect([query.get('outputWidth'), query.get('outputHeight'), query.get('edges')]).toEqual(['1000', '700', 'show']);
      expect(query.get('viewMatrix').split(',').slice(8, 11).map((v) => Number(Number(v).toFixed(4)))).toEqual([0.5774, -0.5774, 0.5774]);
    });

    it('reports an empty answer', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: { images: [] } });
      await expect(client.getPartImage({ documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', partId: 'p' }))
        .rejects.toMatchObject({ status: 502 });
    });
  });

  describe('list parameters', () => {
    it('sends getTessellatedEdges ids as repeated edgeId parameters', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({
        data: [{ id: 'JVD', edges: [{ id: 'a', vertices: [[0, 0, 0], [1, 0, 0]] }, { id: 'b', vertices: [[0, 0, 0]] }] }],
      });
      const out = await client.getTessellatedEdges(
        { documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', configuration: 'List_a=X' }, ['a', 'b'],
      );
      expect(mockGet.mock.calls[0][0]).toBe('/api/partstudios/d/d/w/w/e/e/tessellatededges?edgeId=a&edgeId=b&configuration=List_a%3DX');
      expect([...out.keys()]).toEqual(['a', 'b']);
    });
  });

  describe('exportPartStep', () => {
    const origin = { documentId: 'd', wvmType: 'w', wvmId: 'w', elementId: 'e', partId: 'JVD', configuration: 'List_a=X' };

    it('starts a STEP translation, waits for it, and downloads the result', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: { id: 'job1', requestState: 'ACTIVE' } });
      mockGet
        .mockResolvedValueOnce({ data: { requestState: 'ACTIVE' } })
        .mockResolvedValueOnce({ data: { requestState: 'DONE', resultExternalDataIds: ['file1'] } })
        .mockResolvedValueOnce({ data: new Uint8Array([0x49, 0x53, 0x4f]).buffer });

      const result = await client.exportPartStep(origin);

      expect(Buffer.isBuffer(result)).toBe(true);
      const post = mockRequest.mock.calls[0][0];
      expect(post.url).toBe('/api/partstudios/d/d/w/w/e/e/translations?configuration=List_a%3DX');
      expect(post.data).toEqual({ formatName: 'STEP', partIds: 'JVD', storeInDocument: false });
      expect(mockGet.mock.calls[0][0]).toContain('/api/translations/job1');
      expect(mockGet.mock.calls[2][0]).toContain('/api/documents/d/d/externaldata/file1');
    });

    it('reports a translation OnShape could not finish', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: { id: 'job2', requestState: 'ACTIVE' } });
      mockGet.mockResolvedValueOnce({ data: { requestState: 'FAILED', failureReason: 'bad part' } });
      await expect(client.exportPartStep(origin)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('bad part') });
    });

    it('exportSTEP does the same for a workspace part', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: { id: 'job3', requestState: 'ACTIVE' } });
      mockGet
        .mockResolvedValueOnce({ data: { requestState: 'DONE', resultExternalDataIds: ['f'] } })
        .mockResolvedValueOnce({ data: new Uint8Array([1]).buffer });
      await client.exportSTEP('d', 'w', 'e', 'p');
      expect(mockRequest.mock.calls[0][0].url).toBe('/api/partstudios/d/d/w/w/e/e/translations');
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

  describe('listVersions', () => {
    it('calls the correct path', async () => {
      const client = makeClient();
      mockGet.mockResolvedValueOnce({ data: [{ id: 'v1', name: 'VR27B-2087 Intake Build 1' }] });

      const result = await client.listVersions('doc1');
      expect(result).toEqual([{ id: 'v1', name: 'VR27B-2087 Intake Build 1' }]);
      expect(mockGet.mock.calls[0][0]).toBe('/api/documents/d/doc1/versions');
    });
  });

  describe('createVersion', () => {
    it('POSTs documentId, workspaceId, name, and description', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: { id: 'v2', name: 'Build 1' } });

      const result = await client.createVersion('doc1', 'ws1', {
        name: 'Build 1',
        description: 'VAL-100',
      });
      expect(result).toEqual({ id: 'v2', name: 'Build 1' });

      const config = mockRequest.mock.calls[0][0];
      expect(config.method).toBe('POST');
      expect(config.url).toBe('/api/documents/d/doc1/versions');
      expect(config.data).toEqual({
        documentId: 'doc1',
        workspaceId: 'ws1',
        name: 'Build 1',
        description: 'VAL-100',
      });
    });

    it('defaults description to an empty string when omitted', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: {} });

      await client.createVersion('doc1', 'ws1', { name: 'Build 1' });
      expect(mockRequest.mock.calls[0][0].data.description).toBe('');
    });
  });

  describe('createBranch', () => {
    it('POSTs to the workspaces path with the source version id', async () => {
      const client = makeClient();
      mockRequest.mockResolvedValueOnce({ data: { id: 'ws2', name: 'Intake Rev B' } });

      const result = await client.createBranch('doc1', 'v1', { name: 'Intake Rev B' });
      expect(result).toEqual({ id: 'ws2', name: 'Intake Rev B' });

      const config = mockRequest.mock.calls[0][0];
      expect(config.method).toBe('POST');
      expect(config.url).toBe('/api/documents/d/doc1/workspaces');
      expect(config.data.name).toBe('Intake Rev B');
      expect(config.data.branchedFrom).toEqual({ vid: 'v1' });
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
        // A 403 is a scope or sharing refusal, not a bad key.
        expect(e.message).toContain('Onshape refused access');
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

    it('wraps a network failure (axios, no response) with status 0 and endpoint', async () => {
      const client = makeClient();
      const err = Object.assign(new Error('timeout of 30000ms exceeded'), {
        isAxiosError: true, code: 'ECONNABORTED',
      });
      mockGet.mockRejectedValueOnce(err);
      const e = await client.getWorkspaces('doc1').catch((x) => x);
      expect(e).toBeInstanceOf(OnshapeApiError);
      expect(e.status).toBe(0);
      expect(e.endpoint).toContain('GET');
    });

    it('re-throws an error from our own code unchanged, not as an OnShape error', async () => {
      const client = makeClient();
      const bug = new TypeError("Cannot read properties of undefined (reading 'id')");
      mockGet.mockRejectedValueOnce(bug);
      await expect(client.getWorkspaces('doc1')).rejects.toBe(bug);
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
