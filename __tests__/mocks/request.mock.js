'use strict';

/**
 * Mock implementations for the request module
 * This file provides reusable mock implementations for the request module
 * to be used across different test files.
 */

/**
 * Creates a mock implementation for a successful BOM request
 * @param {Object} customItems - Custom BOM items to include in the response
 * @returns {Function} Mock implementation function for jest.mock
 */
function mockSuccessfulBOMRequest(customItems = []) {
  return (options, callback) => {
    // Default BOM item if none provided
    const defaultItems = [
      {
        item: '1',
        quantity: 2,
        partNumber: 'B5678',
        name: 'Test Part',
        material: { displayName: 'AL 6061' }
      }
    ];
    
    // Use custom items if provided, otherwise use default
    const items = customItems.length > 0 ? customItems : defaultItems;
    
    // Simulate a successful response with valid BOM data
    const response = {
      body: JSON.stringify({
        bomTable: {
          headers: [
            { propertyName: 'quantity' },
            { propertyName: 'partNumber' },
            { propertyName: 'material' },
            { propertyName: 'name' }
          ],
          items: items
        }
      })
    };
    callback(null, response);
  };
}

/**
 * Creates a mock implementation for a failed BOM request
 * @param {string} errorMessage - The error message to return
 * @returns {Function} Mock implementation function for jest.mock
 */
function mockFailedBOMRequest(errorMessage = 'API Error') {
  return (options, callback) => {
    callback(new Error(errorMessage), null);
  };
}

/**
 * Creates a mock implementation for a BOM request with missing fields
 * @param {Array} missingFields - Array of field names to exclude from the headers
 * @returns {Function} Mock implementation function for jest.mock
 */
function mockBOMRequestWithMissingFields(missingFields = ['partNumber']) {
  return (options, callback) => {
    // Create headers excluding the specified missing fields
    const allFields = ['quantity', 'partNumber', 'material', 'name'];
    const headers = allFields
      .filter(field => !missingFields.includes(field))
      .map(field => ({ propertyName: field }));
    
    // Simulate a response with missing fields
    const response = {
      body: JSON.stringify({
        bomTable: {
          headers: headers,
          items: []
        }
      })
    };
    callback(null, response);
  };
}

/**
 * Creates a mock implementation for a successful workspace request
 * @returns {Function} Mock implementation function for jest.mock
 */
function mockSuccessfulWorkspaceRequest() {
  return (options, callback) => {
    const response = {
      body: JSON.stringify([
        { name: 'Main', id: 'ws456' },
        { name: 'Development', id: 'ws789' }
      ])
    };
    callback(null, response);
  };
}

/**
 * Creates a mock implementation for a successful assemblies request
 * @returns {Function} Mock implementation function for jest.mock
 */
function mockSuccessfulAssembliesRequest() {
  return (options, callback) => {
    const response = {
      body: JSON.stringify({
        '1': { id: 'elem789', name: '1234' }
      })
    };
    callback(null, response);
  };
}

module.exports = {
  mockSuccessfulBOMRequest,
  mockFailedBOMRequest,
  mockBOMRequestWithMissingFields,
  mockSuccessfulWorkspaceRequest,
  mockSuccessfulAssembliesRequest
};