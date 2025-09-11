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

# Run live integration tests (requires environment variables)
npm run test:live
```

## Live Integration Tests

The test suite includes live integration tests that make actual HTTP calls to real endpoints. These tests are skipped by default and only run when explicitly enabled.

To run the live tests:

1. Copy `.env.example` to `.env` in the project root
2. Fill in the environment variables with your actual API keys and credentials
3. Run `npm run test:live`

The live tests will verify that your API connections are working correctly and that the ValorBOM class can interact with the real Onshape and JIRA APIs.

### Live Test Behavior

The live tests have different behaviors depending on your configuration:

1. **When `ENABLE_LIVE_TESTS=false` (default)**: All live tests are skipped completely.

2. **When `ENABLE_LIVE_TESTS=true` but using placeholder credentials**:
   - Tests are marked as skipped with a message indicating placeholder credentials are being used
   - No actual API calls are made
   - This is useful for verifying the test structure without making real API calls

3. **When `ENABLE_LIVE_TESTS=true` and using real credentials**:
   - Tests make actual API calls to the specified endpoints
   - Tests validate the responses from the real APIs
   - This is useful for verifying that your API connections are working correctly

**Note:** Live tests with real credentials require valid API keys and internet connectivity. They may also incur API usage costs depending on your service agreements.

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

## Test Types

The test suite includes several types of tests:

- **Unit Tests**: Test individual functions and methods in isolation
- **Integration Tests**: Test multiple components working together with mocked external dependencies
- **Live Integration Tests**: Test the system with real external dependencies (actual API calls)

Each type of test serves a different purpose:

| Test Type | File Pattern | Purpose | Dependencies |
|-----------|--------------|---------|--------------|
| Unit | `ValorBOM.*.test.js` | Test individual functions | Mocked |
| Integration | `ValorBOM.integration.test.js` | Test workflows | Mocked |
| Live | `ValorBOM.live.test.js` | Test real API connections | Real APIs |

It's recommended to run the unit and integration tests during development and the live tests before deployment to ensure everything works with the real APIs.