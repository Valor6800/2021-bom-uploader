'use strict';

// This file contains integration-style tests that test multiple components working together

// Mock the request module
jest.mock('request');

// Import the ValorBOM class
const ValorBOM = require('../src/ValorBOM');

// Import mock helpers
const {
  mockSuccessfulBOMRequest,
  mockFailedBOMRequest,
  mockSuccessfulWorkspaceRequest,
  mockSuccessfulAssembliesRequest
} = require('./mocks/request.mock');

describe('ValorBOM Integration Tests', () => {
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

  describe('getBOM integration', () => {
    it('should handle the full flow from API call to parsed BOM data', () => {
      // Create a custom implementation that also verifies request parameters
      request.mockImplementation((options, callback) => {
        // Verify that the request is made with the correct URL and headers
        expect(options.url).toContain('/api/assemblies/d/doc123/w/ws456/e/elem789/bom');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(options.headers['Authorization']).toBeDefined();
        expect(options.headers['On-Nonce']).toBeDefined();
        expect(options.headers['Date']).toBeDefined();
        
        // Use our mock helper for the actual response
        mockSuccessfulBOMRequest()({}, callback);
      });

      // Call the getBOM method
      const callback = jest.fn();
      valorBOM.getBOM('doc123', 'ws456', 'elem789', callback);

      // Verify that the callback was called with the parsed BOM data
      expect(callback).toHaveBeenCalledWith({
        '1': {
          quantity: 2,
          name: 'Test Part',
          partNumber: 'B5678',
          material: 'AL 6061',
          machinery: 'CNC Router'
        }
      });
    });

    it('should handle API errors gracefully', () => {
      // Use our mock helper for a failed BOM request
      request.mockImplementation(mockFailedBOMRequest('API connection failed'));

      // Call the getBOM method
      expect(() => {
        valorBOM.getBOM('doc123', 'ws456', 'elem789', jest.fn());
      }).toThrow('API connection failed');
    });
  });

  describe('End-to-end workflow test', () => {
    it('should handle a complete workflow from document to BOM', () => {
      // Mock sequence of API calls for a complete workflow
      let callCount = 0;
      
      request.mockImplementation((options, callback) => {
        callCount++;
        
        // First call - getWorkspace
        if (callCount === 1) {
          expect(options.url).toContain('/api/documents/d/doc123/workspaces');
          mockSuccessfulWorkspaceRequest()(options, callback);
        }
        // Second call - getAssemblies
        else if (callCount === 2) {
          expect(options.url).toContain('/api/documents/d/doc123/w/ws456/elements');
          mockSuccessfulAssembliesRequest()(options, callback);
        }
        // Third call - getBOM
        else if (callCount === 3) {
          expect(options.url).toContain('/api/assemblies/d/doc123/w/ws456/e/elem789/bom');
          mockSuccessfulBOMRequest()(options, callback);
        }
      });

      // Mock the workflow methods
      const workspaceCallback = jest.fn(function(workspaceId) {
        expect(workspaceId).toBe('ws456');
        
        const assembliesCallback = jest.fn(function(assemblies) {
          expect(assemblies[0].e).toBe('elem789');
          
          const bomCallback = jest.fn(function(bom) {
            expect(bom['1'].partNumber).toBe('B5678');
          });
          
          valorBOM.getBOM('doc123', 'ws456', 'elem789', bomCallback);
        });
        
        valorBOM.getAssemblies('doc123', workspaceId, assembliesCallback);
      });
      
      // Start the workflow
      valorBOM.getWorkspace('doc123', workspaceCallback);
      
      // Verify all callbacks were called
      expect(workspaceCallback).toHaveBeenCalled();
    });
  });
});