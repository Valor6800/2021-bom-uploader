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
              summary: 'Test Epic',
              description: JSON.stringify({
                d: 'doc123',
                w: 'ws456',
                e: 'elem789'
              })
            }
          },
          {
            key: 'EPIC-456',
            id: '456',
            fields: {
              summary: 'Another Epic',
              description: JSON.stringify({
                d: 'doc456',
                w: 'ws789',
                e: 'elem012'
              })
            }
          }
        ]
      };
      
      // Call the parseEpics method with the callback bound to the mock callback
      valorBOM.parseEpics.bind(callback)(result);
      
      // Verify that the callback was called with the correct parsed data
      expect(callback).toHaveBeenCalledWith({
        '123': {
          summary: 'Test Epic',
          key: 'EPIC-123',
          d: 'doc123',
          w: 'ws456',
          e: 'elem789'
        },
        '456': {
          summary: 'Another Epic',
          key: 'EPIC-456',
          d: 'doc456',
          w: 'ws789',
          e: 'elem012'
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
              customfield_10700: { value: 'AL 6061' },
              summary: 'Test Story',
              customfield_10200: [{ value: 'CNC Router' }],
              customfield_10202: 2,
              project: { key: 'TEST' }
            }
          },
          {
            key: 'STORY-456',
            fields: {
              customfield_10700: { value: 'Nylon' },
              summary: 'Another Story',
              customfield_10200: [{ value: '3D Printer' }],
              customfield_10202: 1,
              project: { key: 'TEST' }
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
          material: 'AL 6061',
          summary: 'Test Story',
          machinery: 'CNC Router',
          quantity: 2,
          project: 'TEST'
        },
        {
          key: 'STORY-456',
          material: 'Nylon',
          summary: 'Another Story',
          machinery: '3D Printer',
          quantity: 1,
          project: 'TEST'
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
      
      // Verify that the callback was called with the ID of the Main workspace
      expect(callback).toHaveBeenCalledWith('ws456');
    });
  });

  describe('parseAssemblies', () => {
    it('should parse assemblies data correctly', () => {
      // Create a mock callback function
      const callback = jest.fn();
      
      // Create a mock result object
      const result = {
        '1': { id: 'elem123', name: '1234' },
        '2': { id: 'elem456', name: '5678' },
        '3': { id: 'elem789', name: 'ABCD' } // No numbers, should be filtered out
      };
      
      // Call the parseAssemblies method with the callback bound to the mock callback
      valorBOM.parseAssemblies.bind(callback)(result);
      
      // Verify that the callback was called with the correct parsed data
      expect(callback).toHaveBeenCalledWith([
        {
          e: 'elem123',
          name: '1234'
        },
        {
          e: 'elem456',
          name: '5678'
        }
      ]);
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
              partNumber: 'A1234',
              name: 'Test Part',
              material: { displayName: 'AL 6061' }
            }
          ]
        }
      };
      
      // Call the parseBOM method with the callback bound to the mock callback
      valorBOM.parseBOM.bind(callback)(result);
      
      // Verify that the callback was called with the correctly parsed data
      expect(callback).toHaveBeenCalledWith({
        '1': {
          quantity: 2,
          name: 'Test Part',
          partNumber: 'A1234',
          material: 'AL 6061',
          machinery: 'CNC Router'
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
              partNumber: 'A123', // Not a Valor part (doesn't match regex - only 4 chars)
              name: 'Non-Valor Part',
              material: { displayName: 'AL 6061' }
            },
            {
              item: '2',
              quantity: 2,
              partNumber: 'B5678', // Valor part (matches regex - 5 chars)
              name: 'Valor Part',
              material: { displayName: 'AL 6061' }
            }
          ]
        }
      };
      
      // Call the parseBOM method with the callback bound to the mock callback
      valorBOM.parseBOM.bind(callback)(result);
      
      // Verify that only the Valor part was included in the result
      const result2 = callback.mock.calls[0][0];
      expect(Object.keys(result2).length).toBe(1);
      expect(result2['2']).toBeDefined();
      expect(result2['1']).toBeUndefined();
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
      valorBOM.parseBOM.bind(callback)(result);
      
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
              partNumber: 'A1234',
              name: 'AL 6061 Part',
              material: { displayName: 'AL 6061' }
            },
            {
              item: '2',
              quantity: 1,
              partNumber: 'B5678',
              name: 'Nylon Part',
              material: { displayName: 'Nylon' }
            },
            {
              item: '3',
              quantity: 1,
              partNumber: 'C9012',
              name: 'Birch Part',
              material: { displayName: 'Birch' }
            },
            {
              item: '4',
              quantity: 1,
              partNumber: 'D3456',
              name: 'Polycarbonate Part',
              material: { displayName: 'Polycarbonate' }
            },
            {
              item: '5',
              quantity: 1,
              partNumber: 'E7890',
              name: 'AL 7075 Part',
              material: { displayName: 'AL 7075' }
            },
            {
              item: '6',
              quantity: 1,
              partNumber: 'F1234',
              name: 'Other Part',
              material: { displayName: 'Other' }
            }
          ]
        }
      };
      
      // Call the parseBOM method with the callback bound to the mock callback
      valorBOM.parseBOM.bind(callback)(result);
      
      // Verify that the callback was called with the correct parsed data
      const parsedBOM = callback.mock.calls[0][0];
      
      // Check AL 6061 part
      expect(parsedBOM['1'].material).toBe('AL 6061');
      expect(parsedBOM['1'].machinery).toBe('CNC Router');
      
      // Check Nylon part
      expect(parsedBOM['2'].material).toBe('Nylon');
      expect(parsedBOM['2'].machinery).toBe('3D Printer');
      
      // Check Birch part
      expect(parsedBOM['3'].material).toBe('Wood');
      expect(parsedBOM['3'].machinery).toBe('CNC Router');
      
      // Check Polycarbonate part
      expect(parsedBOM['4'].material).toBe('Polycarbonate');
      expect(parsedBOM['4'].machinery).toBe('CNC Router');
      
      // Check AL 7075 part
      expect(parsedBOM['5'].material).toBe('AL 7075');
      expect(parsedBOM['5'].machinery).toBe('Manual Lathe');
      
      // Check Other part
      expect(parsedBOM['6'].material).toBe('Other');
      expect(parsedBOM['6'].machinery).toBe('None');
    });
  });
});