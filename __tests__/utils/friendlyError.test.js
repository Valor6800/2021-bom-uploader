import { friendlyError } from '../../src/client/src/lib/friendlyError.js';
import { ApiError, AuthRequiredError } from '../../src/client/src/api/client.js';

const apiError = (status, body) => new ApiError(body.error ?? `Request failed: ${status}`, status, body);

describe('friendlyError', () => {
  it('describes a tracker 503 as not responding', () => {
    expect(friendlyError(apiError(503, { error: 'Service Unavailable', status: 503, source: 'tracker' })))
      .toBe("The team tracker didn't respond (503).");
  });

  it('describes a tracker network failure (sent as 500) as not responding', () => {
    expect(friendlyError(apiError(500, { error: 'ECONNRESET', status: 500, source: 'tracker' })))
      .toBe("The team tracker didn't respond (500).");
  });

  it('describes a tracker 400 as a refusal', () => {
    expect(friendlyError(apiError(400, { error: 'Field x is invalid', status: 400, source: 'tracker' })))
      .toBe('The team tracker refused the change (400).');
  });

  it('describes an OnShape error as not responding', () => {
    expect(friendlyError(apiError(500, { error: 'boom', status: 500, source: 'onshape' })))
      .toBe("OnShape didn't respond (500).");
  });

  it('passes a plain 400 message through unchanged', () => {
    expect(friendlyError(apiError(400, { error: 'HAR-2031 is a Part, not an Assembly', status: 400 })))
      .toBe('HAR-2031 is a Part, not an Assembly');
  });

  it('never matches on message text', () => {
    expect(friendlyError(apiError(400, { error: 'Jira says no', status: 400 })))
      .toBe('Jira says no');
  });

  it('says the server is unreachable when fetch throws a TypeError', () => {
    expect(friendlyError(new TypeError('Failed to fetch')))
      .toBe("Couldn't reach ValorBOM. Is the server running?");
  });

  it('keeps a sign-in error message', () => {
    expect(friendlyError(new AuthRequiredError('Sign-in required', {})))
      .toBe('Sign-in required');
  });
});
