# ValorBOM Test Framework

This directory contains the test framework for ValorBOM using Jest.

## Setup

The test framework is set up with Jest and includes:

- Unit tests for individual functions
- Integration tests for testing multiple components working together
- Mocking of external dependencies (request, url, crypto)
- Environment variable setup for testing

## Running Tests

You can run the tests using the following npm commands:

```bash
# Run all tests
npm test

# Run tests in watch mode (useful during development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Files

- `setup.js`: Sets up environment variables for testing
- `ValorBOM.test.js`: Unit tests for ValorBOM functions
- `ValorBOM.integration.test.js`: Integration tests for ValorBOM workflows

## Adding New Tests

To add new tests:

1. Create a new test file in the `__tests__` directory
2. Import the necessary modules
3. Mock external dependencies as needed
4. Write your tests using Jest's expect API

Example:

```javascript
// Import the module to test
const ValorBOM = require('../src/ValorBOM');

// Mock external dependencies
jest.mock('request');

describe('MyNewFeature', () => {
  let valorBOM;
  
  beforeEach(() => {
    valorBOM = new ValorBOM();
  });
  
  it('should do something specific', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = valorBOM.myFunction(input);
    
    // Assert
    expect(result).toBe('expected output');
  });
});
```

## Mocking HTTP Requests

The tests use Jest's mocking capabilities to mock HTTP requests. This allows testing without making actual API calls.

Example:

```javascript
// Get the mocked request module
const request = require('request');

// Mock the request function
request.mockImplementation((options, callback) => {
  // Simulate a successful response
  const response = {
    body: JSON.stringify({ success: true })
  };
  callback(null, response);
});
```

## Coverage Reports

Coverage reports are generated in the `coverage` directory when running `npm run test:coverage`. These reports show which parts of the code are covered by tests and which are not.