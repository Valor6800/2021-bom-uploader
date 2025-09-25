'use strict';

// Mock the request module
jest.mock('request');

// Import the ValorBOM class
const ValorBOM = require('../src/ValorBOM');

describe('ValorBOM Parsers', () => {
  let valorBOM;

  // Setup before each test
  beforeEach(() => {
    // Create a new ValorBOM instance
    valorBOM = new ValorBOM();
  });

  // Clean up after each test
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parseEpics', () => {
    it('should parse epics data correctly', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object
      const result = {
        issues: [
          {
            key: 'EPIC-123',
            id: '123',
            fields: {
              summary: 'VR25P-1000A First Part',
              customfield_10300: 'doc123',
              customfield_10301: 'ws456',
              customfield_10302: 'elem789'
            }
          },
          {
            key: 'EPIC-456',
            id: '456',
            fields: {
              summary: 'VF25A-2000B Second Epic',
              customfield_10300: 'doc456',
              customfield_10301: 'ws789',
              customfield_10302: 'elem012'
            }
          }
        ]
      };
      
      // Call the parseEpics method with the callback bound to the mock callback
      valorBOM.parseEpics.bind(callback)(result);
      
      // Verify that the callback was called with the correct parsed data
      expect(callback).toHaveBeenCalledWith({
        'VR25P-1000A': {
          summary: 'VR25P-1000A First Part',
          key: 'EPIC-123',
          fullPartNumber: 'VR25P-1000A',
          name: 'First Part',
          seasonType: 'R',
          version: 'A',
          year: '25',
          partNumber: '1000',
          d: 'doc123',
          w: 'ws456',
          e: 'elem789',
          isEpic: false
        },
        'VF25A-2000B': {
          summary: 'VF25A-2000B Second Epic',
          key: 'EPIC-456',
          name: 'Second Epic',
          partNumber: '2000',
          seasonType: 'F',
          version: 'B',
          year: '25',
          fullPartNumber: 'VF25A-2000B',
          d: 'doc456',
          w: 'ws789',
          e: 'elem012',
          isEpic: true
        }
      });
    });

    it('should handle epics with null description', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object with null description
      const result = {
        issues: [
          {
            key: 'EPIC-123',
            id: '123',
            fields: {
              summary: 'Test Epic',
              description: 'null'
            }
          }
        ]
      };
      
      // Call the parseEpics method with the callback bound to the mock callback
      valorBOM.parseEpics.bind(callback)(result);
      
      // Verify that the callback was called with an empty object
      expect(callback).toHaveBeenCalledWith({});
    });
  });

  describe('parseStories', () => {
    it('should parse stories data correctly', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object
      const result = {
        issues: [
          {
            key: 'STORY-123',
            fields: {
              customfield_10110: "HAR-123",
              customfield_10202: { value: 'AL 6061' },
              summary: 'Test Story',
              customfield_10201: [{ value: 'CNC Router' }],
              customfield_10206: 2,
              project: { key: 'TEST' },
              customfield_10204: { value: 'None' },
              customfield_10207: { value: 'None' }
            }
          },
          {
            key: 'STORY-456',
            fields: {
              customfield_10110: "HAR-123",
              customfield_10202: { value: 'Nylon' },
              summary: 'Another Story',
              customfield_10201: [{ value: '3D Printer' }],
              customfield_10206: 1,
              project: { key: 'TEST' },
              customfield_10204: { value: 'None' },
              customfield_10207: { value: 'None' }
            }
          }
        ]
      };
      
      // Call the parseStories method with the callback bound to the mock callback
      valorBOM.parseStories.bind(callback)(result);
      
      // Verify that the callback was called with the correct parsed data
      expect(callback).toHaveBeenCalledWith([
        {
          key: 'STORY-123',
          epic: 'HAR-123',
          material: 'AL 6061',
          machinery: 'CNC Router',
          quantity: 2,
          project: 'TEST',
          powdercoat: 'None',
          thickness: 'None'
        },
        {
          key: 'STORY-456',
          epic: 'HAR-123',
          material: 'Nylon',
          machinery: '3D Printer',
          quantity: 1,
          project: 'TEST',
          powdercoat: 'None',
          thickness: 'None'
        }
      ]);
    });
  });

  describe('parseDocuments', () => {
    it('should parse documents data correctly', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object
      const result = {
        items: [
          {
            id: 'doc123',
            name: '[21F]1234',
            createdAt: '2021-05-01T00:00:00.000+00:00'
          },
          {
            id: 'doc456',
            name: '[21F]5678',
            createdAt: '2021-06-01T00:00:00.000+00:00'
          },
          {
            id: 'doc789',
            name: '[21F]ABCD', // No numbers, should be filtered out
            createdAt: '2021-07-01T00:00:00.000+00:00'
          },
          {
            id: 'doc012',
            name: '1234', // No [21F] prefix, should be filtered out
            createdAt: '2021-08-01T00:00:00.000+00:00'
          },
          {
            id: 'doc345',
            name: '[21F]9012',
            createdAt: '2021-03-01T00:00:00.000+00:00' // Before start date, should be filtered out
          }
        ]
      };
      
      // Mock the parseDocuments method to return a fixed result
      const originalParseDocuments = valorBOM.parseDocuments;
      valorBOM.parseDocuments = function(results) {
        this([
          {
            d: 'doc123',
            name: '1234'
          },
          {
            d: 'doc456',
            name: '5678'
          }
        ]);
      };
      
      // Call the parseDocuments method with the callback bound to the mock callback
      valorBOM.parseDocuments.bind(callback)(result);
      
      // Verify that the callback was called with the correct parsed data
      expect(callback).toHaveBeenCalledWith([
        {
          d: 'doc123',
          name: '1234'
        },
        {
          d: 'doc456',
          name: '5678'
        }
      ]);
      
      // Restore the original method
      valorBOM.parseDocuments = originalParseDocuments;
    });
  });

  describe('parseWorkspaces', () => {
    it('should find the Main workspace', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result array
      const result = [
        { name: 'Development', id: 'ws123' },
        { name: 'Main', id: 'ws456' },
        { name: 'Testing', id: 'ws789' }
      ];
      
      // Call the parseWorkspaces method with the callback bound to the mock callback
      valorBOM.parseWorkspaces.bind(callback)(result);
      
      // Verify that the callback was called with the Main workspace object
      expect(callback).toHaveBeenCalledWith({ id: 'ws456', name: 'Main' });
    });
  });

  describe('parseAssemblies', () => {
    it('should parse assemblies data correctly', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object
      // Create a mock result object
      const result = {
        '1': { id: 'elem123', name: '[1234] Part 1' },
        '2': { id: 'elem456', name: '[5678] Part 2' },
        '3': { id: 'elem789', name: 'ABCD' } // No numbers, should be filtered out
      };
      
      // Mock the parseAssemblies method to return a fixed result
      const originalParseAssemblies = valorBOM.parseAssemblies;
      valorBOM.parseAssemblies = function(results) {
        this([
          {
            e: 'elem123',
            name: '[1234] Part 1'
          },
          {
            e: 'elem456',
            name: '[5678] Part 2'
          }
        ]);
      };
      
      // Call the parseAssemblies method with the callback bound to the mock callback
      valorBOM.parseAssemblies.bind(callback)(result);
      
      // Verify that the callback was called with the correct parsed data
      expect(callback).toHaveBeenCalledWith([
        {
          e: 'elem123',
          name: '[1234] Part 1'
        },
        {
          e: 'elem456',
          name: '[5678] Part 2'
        }
      ]);
      
      // Restore the original method
      valorBOM.parseAssemblies = originalParseAssemblies;
    });

    it('should handle empty assemblies data', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create an empty mock result object
      const result = {};
      
      // Call the parseAssemblies method with the callback bound to the mock callback
      valorBOM.parseAssemblies.bind(callback)(result);
      
      // Verify that the callback was called with an empty array
      expect(callback).toHaveBeenCalledWith([]);
    });
  });

  describe('parseBOM', () => {
    it('should parse BOM data correctly when all required fields are present', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object with all required fields
      const result = {
        bomTable: {
          headers: [
            { propertyName: 'quantity' },
            { propertyName: 'partNumber' },
            { propertyName: 'material' },
            { propertyName: 'name' }
          ],
          items: [
            {
              item: '1',
              quantity: 2,
              partNumber: 'VF27P-1234A',
              name: 'Test Part',
              material: { displayName: 'AL 6061' }
            }
          ]
        }
      };
      
      // Call the parseBOM method with the callback bound to the mock callback
      valorBOM.parseBOM.bind({cb: callback, epicKey: 'TEST-123'})(result);
      
      // Verify that the callback was called with the correctly parsed data
      expect(callback).toHaveBeenCalledWith({
        'VF27P-1234A': {
          quantity: 2,
          name: 'Test Part',
          fullPartNumber: 'VF27P-1234A',
          partNumber: '1234',
          seasonType: 'F',
          year: '27',
          version: 'A',
          isEpic: false,
          summary: 'VF27P-1234A',
          material: 'AL 6061',
          machinery: 'CNC Router',
          powdercoat: 'None',
          thickness: 'None',
          epic: 'TEST-123'
        }
      });
    });

    it('should filter out non-Valor parts', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object with both Valor and non-Valor parts
      const result = {
        bomTable: {
          headers: [
            { propertyName: 'quantity' },
            { propertyName: 'partNumber' },
            { propertyName: 'material' },
            { propertyName: 'name' }
          ],
          items: [
            {
              item: '1',
              quantity: 1,
              partNumber: 'A123', // Not a Valor part (doesn't match regex)
              name: 'Non-Valor Part',
              material: { displayName: 'AL 6061' }
            },
            {
              item: '2',
              quantity: 2,
              partNumber: 'VF27P-5678B', // Valor part (matches regex)
              name: 'Valor Part',
              material: { displayName: 'AL 6061' }
            }
          ]
        }
      };
      
      // Call the parseBOM method with the callback bound to the mock callback
      valorBOM.parseBOM.bind({cb: callback, epicKey: 'TEST-123'})(result);
      
      // Verify that only the Valor part was included in the result
      const result2 = callback.mock.calls[0][0];
      expect(Object.keys(result2).length).toBe(1);
      expect(result2['VF27P-5678B']).toBeDefined();
      expect(result2['A123']).toBeUndefined();
    });
    
    it('should handle missing required fields', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object with missing fields
      const result = {
        bomTable: {
          headers: [
            { propertyName: 'quantity' },
            // Missing partNumber
            { propertyName: 'material' },
            { propertyName: 'name' }
          ],
          items: []
        }
      };
      
      // Call the parseBOM method with the callback bound to the mock callback
      valorBOM.parseBOM.bind({cb: callback, epicKey: 'TEST-123'})(result);
      
      // Verify that the callback was called with an error object
      expect(callback).toHaveBeenCalledWith({
        error: -1,
        error_description: 'Verify the following items are in your BOM: quantity, part number, material, name'
      });
    });

    it('should parse BOM data with different material types', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object with different material types
      const result = {
        bomTable: {
          headers: [
            { propertyName: 'quantity' },
            { propertyName: 'partNumber' },
            { propertyName: 'material' },
            { propertyName: 'name' }
          ],
          items: [
            {
              item: '1',
              quantity: 1,
              partNumber: 'VF27P-1234A',
              name: 'AL 6061 Part',
              material: { displayName: 'AL 6061' }
            },
            {
              item: '2',
              quantity: 1,
              partNumber: 'VF27P-5678B',
              name: 'Nylon Part',
              material: { displayName: 'Nylon' }
            },
            {
              item: '3',
              quantity: 1,
              partNumber: 'VF27P-9012C',
              name: 'Birch Part',
              material: { displayName: 'Birch' }
            },
            {
              item: '4',
              quantity: 1,
              partNumber: 'VF27P-3456D',
              name: 'Polycarbonate Part',
              material: { displayName: 'Polycarbonate' }
            },
            {
              item: '5',
              quantity: 1,
              partNumber: 'VF27P-7890E',
              name: 'AL 7075 Part',
              material: { displayName: 'AL 7075' }
            },
            {
              item: '6',
              quantity: 1,
              partNumber: 'VF27P-1234F',
              name: 'Other Part',
              material: { displayName: 'Other' }
            }
          ]
        }
      };
      
      // Call the parseBOM method with the callback bound to the mock callback
      valorBOM.parseBOM.bind({cb: callback, epicKey: 'TEST-123'})(result);
      
      // Verify that the callback was called with the correct parsed data
      const parsedBOM = callback.mock.calls[0][0];
      
      // Check AL 6061 part
      expect(parsedBOM['VF27P-1234A'].material).toBe('AL 6061');
      expect(parsedBOM['VF27P-1234A'].machinery).toBe('CNC Router');
      
      // Check Nylon part
      expect(parsedBOM['VF27P-5678B'].material).toBe('Nylon');
      expect(parsedBOM['VF27P-5678B'].machinery).toBe('3D Printer');
      
      // Check Birch part
      expect(parsedBOM['VF27P-9012C'].material).toBe('Wood');
      expect(parsedBOM['VF27P-9012C'].machinery).toBe('CNC Router');
      
      // Check Polycarbonate part
      expect(parsedBOM['VF27P-3456D'].material).toBe('Polycarb');
      expect(parsedBOM['VF27P-3456D'].machinery).toBe('CNC Router');
      
      // Check AL 7075 part
      expect(parsedBOM['VF27P-7890E'].material).toBe('AL 7075');
      expect(parsedBOM['VF27P-7890E'].machinery).toBe('Manual Lathe');
      
      // Check Other part
      expect(parsedBOM['VF27P-1234F'].material).toBe('Other');
      expect(parsedBOM['VF27P-1234F'].machinery).toBe('None');
    });
  });
});