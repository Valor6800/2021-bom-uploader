'use strict';

// This file tests the module exports of ValorBOM.js

describe('ValorBOM Module', () => {
  it('should export ValorBOM class', () => {
    // Load the module
    const ValorBOM = require('../src/ValorBOM');
    
    // Verify that the module exports the ValorBOM class
    expect(typeof ValorBOM).toBe('function');
    expect(ValorBOM.name).toBe('ValorBOM');
    expect(typeof ValorBOM.prototype.getBOM).toBe('function');
    
    // Verify that exports.ValorBOM is also set
    expect(typeof require('../src/ValorBOM').ValorBOM).toBe('function');
  });
  
  it('should have all required methods', () => {
    // Load the module
    const ValorBOM = require('../src/ValorBOM');
    
    // Create an instance
    const valorBOM = new ValorBOM();
    
    // Verify that all methods exist
    expect(typeof valorBOM.genNonce).toBe('function');
    expect(typeof valorBOM.createSignature).toBe('function');
    expect(typeof valorBOM.onshape_httpGET).toBe('function');
    expect(typeof valorBOM.onshape_httpEXPORT).toBe('function');
    expect(typeof valorBOM.jira_httpGET).toBe('function');
    expect(typeof valorBOM.jira_httpPOST).toBe('function');
    expect(typeof valorBOM.jira_httpPUT).toBe('function');
    expect(typeof valorBOM.parseEpics).toBe('function');
    expect(typeof valorBOM.parseStories).toBe('function');
    expect(typeof valorBOM.parseDocuments).toBe('function');
    expect(typeof valorBOM.parseWorkspaces).toBe('function');
    expect(typeof valorBOM.parseAssemblies).toBe('function');
    expect(typeof valorBOM.parseBOM).toBe('function');
    expect(typeof valorBOM.getSTL).toBe('function');
    expect(typeof valorBOM.getBOM).toBe('function');
    expect(typeof valorBOM.getEpics).toBe('function');
    expect(typeof valorBOM.getEpic).toBe('function');
    expect(typeof valorBOM.getStoriesByPartNumber).toBe('function');
    expect(typeof valorBOM.getStoriesByEpic).toBe('function');
    expect(typeof valorBOM.getDocuments).toBe('function');
    expect(typeof valorBOM.getWorkspace).toBe('function');
    expect(typeof valorBOM.getAssemblies).toBe('function');
    expect(typeof valorBOM.syncEpics).toBe('function');
    expect(typeof valorBOM.postStory).toBe('function');
    expect(typeof valorBOM.postEpic).toBe('function');
    expect(typeof valorBOM.putStory).toBe('function');
  });
});