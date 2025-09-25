'use strict';

// Mock the request module
jest.mock('request');

// Import the ValorBOM class
const ValorBOM = require('../src/ValorBOM');

describe('ValorBOM Operations', () => {
  let valorBOM;
  let request;

  // Setup before each test
  beforeEach(() => {
    // Get the mocked request module
    request = require('request');
    
    // Create a new ValorBOM instance
    valorBOM = new ValorBOM();
  });

  // Clean up after each test
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('syncEpics', () => {
    it('should orchestrate the sync process correctly', () => {
      // Mock the getDocuments method
      valorBOM.getDocuments = jest.fn((param1, param2, callback) => {
        callback([
          { d: 'doc123', name: '1234' }
        ]);
      });
      
      // Mock the getWorkspace method
      valorBOM.getWorkspace = jest.fn((documentId, callback) => {
        expect(documentId).toBe('doc123');
        callback({ id: 'ws456', name: 'Main' });
      });
      
      // Mock the getAssemblies method
      valorBOM.getAssemblies = jest.fn((documentId, workspaceId, callback) => {
        expect(documentId).toBe('doc123');
        expect(workspaceId).toBe('ws456');
        callback([
          { e: 'elem789', name: 'VR25P-1234A Test', fullPartNumber: 'VR25P-1234A Test', description: 'VR25P-1234A Test', summary: 'VR25P-1234A Test'}
        ]);
      });
      
      // Mock the getEpic method
      valorBOM.getEpic = jest.fn((partNumber, callback) => {
        expect(partNumber).toBe('VR25P-1234A Test');
        callback({});
      });
      
      // Mock the postEpic method
      valorBOM.postEpic = jest.fn((payload, callback) => {
        expect(payload.summary).toBe('VR25P-1234A Test');
        expect(payload.d).toEqual('doc123')
        expect(payload.w).toEqual('ws456')
        expect(payload.e).toEqual('elem789')
        callback({});
      });
      
      // Call the syncEpics method
      valorBOM.syncEpics("R", "25");
      
      // Verify that all methods were called
      expect(valorBOM.getDocuments).toHaveBeenCalled();
      expect(valorBOM.getWorkspace).toHaveBeenCalled();
      expect(valorBOM.getAssemblies).toHaveBeenCalled();
      expect(valorBOM.getEpic).toHaveBeenCalled();
      expect(valorBOM.postEpic).toHaveBeenCalled();
    });

    it('should not create epic if it already exists', () => {
      // Mock the getDocuments method
      valorBOM.getDocuments = jest.fn((param1, param2, callback) => {
        callback([
          { d: 'doc123', name: '1234' }
        ]);
      });
      
      // Mock the getWorkspace method
      valorBOM.getWorkspace = jest.fn((documentId, callback) => {
        callback('ws456');
      });
      
      // Mock the getAssemblies method
      valorBOM.getAssemblies = jest.fn((documentId, workspaceId, callback) => {
        callback([
          { e: 'elem789', name: 'VR25P-1234A Test' }
        ]);
      });
      
      // Mock the getEpic method to return an existing epic
      valorBOM.getEpic = jest.fn((partNumber, callback) => {
        callback({ '123': { key: 'EPIC-123', summary: 'Existing Epic' } });
      });
      
      // Mock the postEpic method
      valorBOM.postEpic = jest.fn();
      
      // Call the syncEpics method
      valorBOM.syncEpics();
      
      // Verify that postEpic was not called
      expect(valorBOM.postEpic).not.toHaveBeenCalled();
    });
  });

  describe('postStory', () => {
    it('should call jira_httpPOST with the correct URL and data', () => {
      // Spy on the jira_httpPOST method
      const spy = jest.spyOn(valorBOM, 'jira_httpPOST');
      
      // Mock the jira_httpPOST method to prevent actual execution
      valorBOM.jira_httpPOST = jest.fn();
      
      // Call the postStory method
      const payload = {
        summary: 'Test Story',
        machinery: 'CNC Router',
        quantity: 2,
        epic: 'EPIC-123',
        material: 'AL 6061'
      };
      const callback = jest.fn();
      
      valorBOM.postStory(payload, callback);
      
      // Verify that jira_httpPOST was called with the correct URL and data
      const expectedUrl = '/rest/api/latest/issue';
      const expectedData = {
        fields: {
          project: {
            key: 'TEST'
          },
          summary: 'Test Story',
          issuetype: {
            name: 'Part'
          },
          customfield_10201: [
            {
              value: 'CNC Router'
            }
          ],
          customfield_10206: 2,
          customfield_10110: 'EPIC-123',
          customfield_10202: {
            value: 'AL 6061'
          }
        }
      };
      
      expect(valorBOM.jira_httpPOST).toHaveBeenCalledWith(expectedUrl, expectedData, callback);
    });
  });

  describe('postEpic', () => {
    it('should call jira_httpPOST with the correct URL and data', () => {
      // Spy on the jira_httpPOST method
      const spy = jest.spyOn(valorBOM, 'jira_httpPOST');
      
      // Mock the jira_httpPOST method to prevent actual execution
      valorBOM.jira_httpPOST = jest.fn();
      
      // Call the postEpic method
      const payload = {
        summary: 'Test Epic',
        description: JSON.stringify({
          d: 'doc123',
          w: 'ws456',
          e: 'elem789'
        })
      };
      const callback = jest.fn();
      
      valorBOM.postEpic(payload, callback);
      
      // Verify that jira_httpPOST was called with the correct URL and data
      const expectedUrl = '/rest/api/latest/issue';
      const expectedData = {
        fields: {
          project: {
            key: 'TEST'
          },
          summary: 'Test Epic',
          issuetype: {
            name: 'Assembly'
          },
          customfield_10104: 'Test Epic',
          description: JSON.stringify({
            d: 'doc123',
            w: 'ws456',
            e: 'elem789'
          })
        }
      };
      
      expect(valorBOM.jira_httpPOST).toHaveBeenCalledWith(expectedUrl, expectedData, callback);
    });
  });

  describe('putStory', () => {
    it('should call jira_httpPUT with the correct URL and data', () => {
      // Spy on the jira_httpPUT method
      const spy = jest.spyOn(valorBOM, 'jira_httpPUT');
      
      // Mock the jira_httpPUT method to prevent actual execution
      valorBOM.jira_httpPUT = jest.fn();
      
      // Call the putStory method
      const key = 'STORY-123';
      const payload = {
        summary: 'Updated Story',
        machinery: 'CNC Router',
        quantity: 3,
        material: 'AL 6061'
      };
      const callback = jest.fn();
      
      valorBOM.putStory(key, payload, callback);
      
      // Verify that jira_httpPUT was called with the correct URL and data
      const expectedUrl = '/rest/api/latest/issue/STORY-123';
      const expectedData = {
        fields: {
          summary: 'Updated Story',
          customfield_10201: [
            {
              value: 'CNC Router'
            }
          ],
          customfield_10206: 3,
          customfield_10202: {
            value: 'AL 6061'
          }
        }
      };
      
      expect(valorBOM.jira_httpPUT).toHaveBeenCalledWith(expectedUrl, expectedData, callback);
    });
  });

  describe('genNonce', () => {
    it('should generate a random string of the specified length', () => {
      // Call the genNonce method
      const length = 10;
      const nonce = valorBOM.genNonce(length);
      
      // Verify that the nonce is a string of the specified length
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBe(length);
      
      // Verify that the nonce contains only alphanumeric characters
      expect(nonce).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should generate different nonces on subsequent calls', () => {
      // Call the genNonce method twice
      const nonce1 = valorBOM.genNonce(10);
      const nonce2 = valorBOM.genNonce(10);
      
      // Verify that the nonces are different
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('createSignature', () => {
    it('should create a valid signature', () => {
      // Call the createSignature method
      const method = 'GET';
      const url = 'https://cad.onshape.com/api/documents';
      const nonce = 'abcde12345';
      const authDate = 'Wed, 01 Sep 2021 12:00:00 GMT';
      const contentType = 'application/json';
      const accessKey = 'test_access_key';
      const secretKey = 'test_secret_key';
      
      const signature = valorBOM.createSignature(method, url, nonce, authDate, contentType, accessKey, secretKey);
      
      // Verify that the signature is a string and has the expected format
      expect(typeof signature).toBe('string');
      expect(signature).toMatch(/^On test_access_key:HmacSHA256:[A-Za-z0-9+/=]+$/);
    });

    it('should handle URLs with query parameters', () => {
      // Call the createSignature method with a URL that has query parameters
      const method = 'GET';
      const url = 'https://cad.onshape.com/api/documents?filter=owner&sortColumn=modifiedAt';
      const nonce = 'abcde12345';
      const authDate = 'Wed, 01 Sep 2021 12:00:00 GMT';
      const contentType = 'application/json';
      const accessKey = 'test_access_key';
      const secretKey = 'test_secret_key';
      
      const signature = valorBOM.createSignature(method, url, nonce, authDate, contentType, accessKey, secretKey);
      
      // Verify that the signature is a string and has the expected format
      expect(typeof signature).toBe('string');
      expect(signature).toMatch(/^On test_access_key:HmacSHA256:[A-Za-z0-9+/=]+$/);
    });
  });

  describe('constructor', () => {
    it('should initialize properties from environment variables', () => {
      // Verify that the properties are initialized from environment variables
      expect(valorBOM.jira_base_url).toBe('https://jira.example.com');
      expect(valorBOM.onshape_base_url).toBe('https://cad.onshape.com');
      expect(valorBOM.project_key).toBe('TEST');
      expect(valorBOM.SECRET_KEY).toBe('test_secret_key');
      expect(valorBOM.API_KEY).toBe('test_api_key');
      expect(valorBOM.JIRA_KEY).toBe('test_jira_key');
      expect(valorBOM.ONSHAPE_TEAM_ID).toBe('test_team_id');
      expect(valorBOM.assembly_map).toEqual({});
    });
  });

  describe('module exports', () => {
    it('should export the ValorBOM class', () => {
      // Verify that the module exports the ValorBOM class
      expect(typeof ValorBOM).toBe('function');
      expect(ValorBOM.name).toBe('ValorBOM');
    });
  });
});