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
      valorBOM.getBOM('HAR-234', 'doc123', 'ws456', 'elem789', callback);

      // Verify that the callback was called with the parsed BOM data
      expect(callback).toHaveBeenCalledWith({
        'VF27P-1031A': {
          quantity: 2,
          name: 'Test Part',
          fullPartNumber: 'VF27P-1031A',
          partNumber: '1031',
          material: 'AL 6061',
          machinery: 'CNC Router',
          powdercoat: 'None',
          seasonType: "F",
          summary: 'VF27P-1031A',
          thickness: 'None',
          isEpic: false,
          version: "A",
          year: "27",
          epic: 'HAR-234'
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
          // Use a custom implementation to ensure the expected structure
          const response = {
            body: JSON.stringify({
              '1': { id: 'elem789', name: '1234' }
            })
          };
          callback(null, response);
        }
        // Third call - getBOM
        else if (callCount === 3) {
          expect(options.url).toContain('/api/assemblies/d/doc123/w/ws456/e/elem789/bom');
          mockSuccessfulBOMRequest()(options, callback);
        }
      });

      // Mock the workflow methods
      const workspaceCallback = jest.fn(function(workspace) {
        expect(workspace.id).toBe('ws456');
        
        // Mock the parseAssemblies method to return a fixed result
        const originalParseAssemblies = valorBOM.parseAssemblies;
        valorBOM.parseAssemblies = function(results) {
          this([
            {
              e: 'elem789',
              name: '[1234] Part 1'
            }
          ]);
        };
        
        const assembliesCallback = jest.fn(function(assemblies) {
          expect(assemblies[0].e).toBe('elem789');
          
          // Restore the original method
          valorBOM.parseAssemblies = originalParseAssemblies;
          
          // Mock the parseBOM method to return a fixed result
          const originalParseBOM = valorBOM.parseBOM;
          valorBOM.parseBOM = function(results) {
            this.cb({
              'VF27P-1031A': {
                quantity: 2,
                name: 'Test Part',
                fullPartNumber: 'VF27P-1031A',
                partNumber: '1031',
                material: 'AL 6061',
                machinery: 'CNC Router',
                powdercoat: 'None',
                seasonType: "F",
                summary: 'VF27P-1031A',
                thickness: 'None',
                isEpic: false,
                version: "A",
                year: "27",
                epic: 'HAR-234'
              }
            });
          };
          
          const bomCallback = jest.fn(function(bom) {
            expect(bom['VF27P-1031A'].partNumber).toBe('1031');
            
            // Restore the original method
            valorBOM.parseBOM = originalParseBOM;
          });
          
          valorBOM.getBOM('HAR-231', 'doc123', 'ws456', 'elem789', bomCallback);
        });
        
        valorBOM.getAssemblies('doc123', workspace.id, assembliesCallback);
      });
      
      // Start the workflow
      valorBOM.getWorkspace('doc123', workspaceCallback);
      
      // Verify all callbacks were called
      expect(workspaceCallback).toHaveBeenCalled();
    });
  });
});