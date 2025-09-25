'use strict';

// Mock the request module
jest.mock('request');

// Import the ValorBOM class
const ValorBOM = require('../src/ValorBOM');

// Import mock helpers
const {
  mockSuccessfulBOMRequest,
  mockFailedBOMRequest
} = require('./mocks/request.mock');

describe('ValorBOM HTTP Methods', () => {
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

  describe('onshape_httpGET', () => {
    it('should make a GET request with the correct headers', () => {
      // Mock the request function
      request.mockImplementation((options, callback) => {
        // Verify that the request is made with the correct method and headers
        expect(options.method).toBe('GET');
        expect(options.url).toBe('https://cad.onshape.com/test-url');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(options.headers['Authorization']).toBeDefined();
        expect(options.headers['On-Nonce']).toBeDefined();
        expect(options.headers['Date']).toBeDefined();
        
        // Simulate a successful response
        const response = {
          body: JSON.stringify({ success: true })
        };
        callback(null, response);
      });

      // Create a spy for the callback
      const callback = jest.fn();
      
      // Call the method
      valorBOM.onshape_httpGET('/test-url', callback);
      
      // Verify that the callback was called with the parsed response
      expect(callback).toHaveBeenCalledWith({ success: true });
    });

    it('should throw an error when the request fails', () => {
      // Mock the request function to simulate an error
      request.mockImplementation((options, callback) => {
        callback(new Error('Request failed'), null);
      });

      // Call the method and expect it to throw
      expect(() => {
        valorBOM.onshape_httpGET('/test-url', jest.fn());
      }).toThrow('Request failed');
    });
  });

  describe('onshape_httpEXPORT', () => {
    it('should make a GET request with the correct headers for export', () => {
      // Mock the request function
      request.mockImplementation((options, callback) => {
        // Verify that the request is made with the correct method and headers
        expect(options.method).toBe('GET');
        expect(options.url).toBe('https://cad.onshape.com/test-export-url');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(options.headers['Accept']).toBe('application/vnd.onshape.v1+octet-stream');
        expect(options.headers['Authorization']).toBeDefined();
        expect(options.headers['On-Nonce']).toBeDefined();
        expect(options.headers['Date']).toBeDefined();
        
        // Simulate a successful response
        const response = {
          body: JSON.stringify({ exportData: true })
        };
        callback(null, response);
      });

      // Create a spy for the callback
      const callback = jest.fn();
      
      // Call the method
      valorBOM.onshape_httpEXPORT('/test-export-url', callback);
      
      // Verify that the callback was called with the parsed response
      expect(callback).toHaveBeenCalledWith({ exportData: true });
    });

    it('should throw an error when the export request fails', () => {
      // Mock the request function to simulate an error
      request.mockImplementation((options, callback) => {
        callback(new Error('Export failed'), null);
      });

      // Call the method and expect it to throw
      expect(() => {
        valorBOM.onshape_httpEXPORT('/test-export-url', jest.fn());
      }).toThrow('Export failed');
    });
  });

  describe('jira_httpGET', () => {
    it('should make a GET request to JIRA with the correct headers', () => {
      // Mock the request function
      request.mockImplementation((options, callback) => {
        // Verify that the request is made with the correct method and headers
        expect(options.method).toBe('GET');
        expect(options.url).toBe('https://jira.example.com/test-jira-url');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(options.headers['Authorization']).toBe('Bearer test_jira_key');
        
        // Simulate a successful response
        const response = {
          body: JSON.stringify({ jiraData: true })
        };
        callback(null, response);
      });

      // Create a spy for the callback
      const callback = jest.fn();
      
      // Call the method
      valorBOM.jira_httpGET('/test-jira-url', callback);
      
      // Verify that the callback was called with the parsed response
      expect(callback).toHaveBeenCalledWith({ jiraData: true });
    });

    it('should throw an error when the JIRA GET request fails', () => {
      // Mock the request function to simulate an error
      request.mockImplementation((options, callback) => {
        callback(new Error('JIRA GET failed'), null);
      });

      // Call the method and expect it to throw
      expect(() => {
        valorBOM.jira_httpGET('/test-jira-url', jest.fn());
      }).toThrow('JIRA GET failed');
    });
  });

  describe('jira_httpPOST', () => {
    it('should make a POST request to JIRA with the correct headers and body', () => {
      // Mock the request function
      request.mockImplementation((options, callback) => {
        // Verify that the request is made with the correct method, headers, and body
        expect(options.method).toBe('POST');
        expect(options.url).toBe('https://jira.example.com/test-jira-post-url');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(options.headers['Authorization']).toBe('Bearer test_jira_key');
        expect(options.body).toBe(JSON.stringify({ testData: 'post data' }));
        
        // Simulate a successful response
        const response = {
          body: JSON.stringify({ postResponse: true })
        };
        callback(null, response);
      });

      // Create a spy for the callback
      const callback = jest.fn();
      
      // Call the method
      valorBOM.jira_httpPOST('/test-jira-post-url', { testData: 'post data' }, callback);
      
      // Verify that the callback was called with the parsed response
      expect(callback).toHaveBeenCalledWith({ postResponse: true });
    });

    it('should throw an error when the JIRA POST request fails', () => {
      // Mock the request function to simulate an error
      request.mockImplementation((options, callback) => {
        callback(new Error('JIRA POST failed'), null);
      });

      // Call the method and expect it to throw
      expect(() => {
        valorBOM.jira_httpPOST('/test-jira-post-url', { testData: 'post data' }, jest.fn());
      }).toThrow('JIRA POST failed');
    });
  });

  describe('jira_httpPUT', () => {
    it('should make a PUT request to JIRA with the correct headers and body', () => {
      // Mock the request function
      request.mockImplementation((options, callback) => {
        // Verify that the request is made with the correct method, headers, and body
        expect(options.method).toBe('PUT');
        expect(options.url).toBe('https://jira.example.com/test-jira-put-url');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(options.headers['Authorization']).toBe('Bearer test_jira_key');
        expect(options.body).toBe(JSON.stringify({ testData: 'put data' }));
        
        // Simulate a successful response
        callback(null, {});
      });

      // Create a spy for the callback
      const callback = jest.fn();
      
      // Call the method
      valorBOM.jira_httpPUT('/test-jira-put-url', { testData: 'put data' }, callback);
      
      // Verify that the callback was called
      expect(callback).toHaveBeenCalled();
    });

    it('should throw an error when the JIRA PUT request fails', () => {
      // Mock the request function to simulate an error
      request.mockImplementation((options, callback) => {
        callback(new Error('JIRA PUT failed'), null);
      });

      // Call the method and expect it to throw
      expect(() => {
        valorBOM.jira_httpPUT('/test-jira-put-url', { testData: 'put data' }, jest.fn());
      }).toThrow('JIRA PUT failed');
    });
  });
});