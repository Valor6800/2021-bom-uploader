'use strict';

// Mock the request module
jest.mock('request');

// Import the ValorBOM class
const ValorBOM = require('../src/ValorBOM');

describe('ValorBOM Getters', () => {
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

  describe('getSTL', () => {
    it('should call onshape_httpEXPORT with the correct URL', () => {
      // Spy on the onshape_httpEXPORT method
      const spy = jest.spyOn(valorBOM, 'onshape_httpEXPORT');
      
      // Mock the onshape_httpEXPORT method to prevent actual execution
      valorBOM.onshape_httpEXPORT = jest.fn();
      
      // Call the getSTL method
      const documentId = 'doc123';
      const workspaceId = 'ws456';
      const elementId = 'elem789';
      const partId = 'part012';
      const callback = jest.fn();
      
      valorBOM.getSTL(documentId, workspaceId, elementId, partId, callback);
      
      // Verify that onshape_httpEXPORT was called with the correct URL
      const expectedUrl = '/api/parts/d/doc123/w/ws456/e/elem789/partid/part012/stl/?grouping=true&scale=1.0&units=millimeter&mode=binary';
      expect(valorBOM.onshape_httpEXPORT).toHaveBeenCalledWith(expectedUrl, callback);
    });
  });

  describe('getBOM', () => {
    it('should call onshape_httpGET with the correct URL and callback', () => {
      // Spy on the onshape_httpGET method
      const spy = jest.spyOn(valorBOM, 'onshape_httpGET');
      
      // Mock the onshape_httpGET method to prevent actual execution
      valorBOM.onshape_httpGET = jest.fn();
      
      // Call the getBOM method
      const documentId = 'doc123';
      const workspaceId = 'ws456';
      const elementId = 'elem789';
      const callback = jest.fn();
      
      valorBOM.getBOM(documentId, workspaceId, elementId, callback);
      
      // Verify that onshape_httpGET was called with the correct URL and callback
      const expectedUrl = '/api/assemblies/d/doc123/w/ws456/e/elem789/bom?indented=false';
      expect(valorBOM.onshape_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });

  describe('getEpics', () => {
    it('should call jira_httpGET with the correct URL and callback', () => {
      // Spy on the jira_httpGET method
      const spy = jest.spyOn(valorBOM, 'jira_httpGET');
      
      // Mock the jira_httpGET method to prevent actual execution
      valorBOM.jira_httpGET = jest.fn();
      
      // Call the getEpics method
      const callback = jest.fn();
      
      valorBOM.getEpics(callback);
      
      // Verify that jira_httpGET was called with the correct URL and callback
      const expectedUrl = '/rest/api/latest/search?jql=project = TEST AND issuetype = Epic';
      expect(valorBOM.jira_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });

  describe('getEpic', () => {
    it('should call jira_httpGET with the correct URL and callback', () => {
      // Spy on the jira_httpGET method
      const spy = jest.spyOn(valorBOM, 'jira_httpGET');
      
      // Mock the jira_httpGET method to prevent actual execution
      valorBOM.jira_httpGET = jest.fn();
      
      // Call the getEpic method
      const partNumber = '1234';
      const callback = jest.fn();
      
      valorBOM.getEpic(partNumber, callback);
      
      // Verify that jira_httpGET was called with the correct URL and callback
      const expectedUrl = '/rest/api/latest/search?jql=project = TEST AND issuetype = Epic AND text ~ "1234"';
      expect(valorBOM.jira_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });

  describe('getStoriesByPartNumber', () => {
    it('should call jira_httpGET with the correct URL and callback', () => {
      // Spy on the jira_httpGET method
      const spy = jest.spyOn(valorBOM, 'jira_httpGET');
      
      // Mock the jira_httpGET method to prevent actual execution
      valorBOM.jira_httpGET = jest.fn();
      
      // Call the getStoriesByPartNumber method
      const partNumber = '1234';
      const callback = jest.fn();
      
      valorBOM.getStoriesByPartNumber(partNumber, callback);
      
      // Verify that jira_httpGET was called with the correct URL and callback
      const expectedUrl = '/rest/api/latest/search?jql=project = TEST AND summary ~ 1234 AND issuetype = Story';
      expect(valorBOM.jira_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });

  describe('getStoriesByEpic', () => {
    it('should call jira_httpGET with the correct URL and callback', () => {
      // Spy on the jira_httpGET method
      const spy = jest.spyOn(valorBOM, 'jira_httpGET');
      
      // Mock the jira_httpGET method to prevent actual execution
      valorBOM.jira_httpGET = jest.fn();
      
      // Call the getStoriesByEpic method
      const epicId = '123';
      const callback = jest.fn();
      
      valorBOM.getStoriesByEpic(epicId, callback);
      
      // Verify that jira_httpGET was called with the correct URL and callback
      const expectedUrl = '/rest/api/latest/search?jql=project = TEST AND issuetype = Story AND "Epic Link"=123';
      expect(valorBOM.jira_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });

  describe('getDocuments', () => {
    it('should call onshape_httpGET with the correct URL and callback', () => {
      // Spy on the onshape_httpGET method
      const spy = jest.spyOn(valorBOM, 'onshape_httpGET');
      
      // Mock the onshape_httpGET method to prevent actual execution
      valorBOM.onshape_httpGET = jest.fn();
      
      // Call the getDocuments method
      const callback = jest.fn();
      
      valorBOM.getDocuments(callback);
      
      // Verify that onshape_httpGET was called with the correct URL and callback
      const expectedUrl = '/api/documents?q=%5B21F%5D&filter=9&owner=test_team_id&sortColumn=createdAt&sortOrder=desc';
      expect(valorBOM.onshape_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });

  describe('getWorkspace', () => {
    it('should call onshape_httpGET with the correct URL and callback', () => {
      // Spy on the onshape_httpGET method
      const spy = jest.spyOn(valorBOM, 'onshape_httpGET');
      
      // Mock the onshape_httpGET method to prevent actual execution
      valorBOM.onshape_httpGET = jest.fn();
      
      // Call the getWorkspace method
      const documentId = 'doc123';
      const callback = jest.fn();
      
      valorBOM.getWorkspace(documentId, callback);
      
      // Verify that onshape_httpGET was called with the correct URL and callback
      const expectedUrl = '/api/documents/d/doc123/workspaces';
      expect(valorBOM.onshape_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });

  describe('getAssemblies', () => {
    it('should call onshape_httpGET with the correct URL and callback', () => {
      // Spy on the onshape_httpGET method
      const spy = jest.spyOn(valorBOM, 'onshape_httpGET');
      
      // Mock the onshape_httpGET method to prevent actual execution
      valorBOM.onshape_httpGET = jest.fn();
      
      // Call the getAssemblies method
      const documentId = 'doc123';
      const workspaceId = 'ws456';
      const callback = jest.fn();
      
      valorBOM.getAssemblies(documentId, workspaceId, callback);
      
      // Verify that onshape_httpGET was called with the correct URL and callback
      const expectedUrl = '/api/documents/d/doc123/w/ws456/elements?elementType=ASSEMBLY';
      expect(valorBOM.onshape_httpGET).toHaveBeenCalledWith(expectedUrl, expect.any(Function));
    });
  });
});