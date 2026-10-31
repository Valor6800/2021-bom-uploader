import { AxiosError } from 'axios';
import { describeUpstreamError, isNetworkError } from '../../src/server/utils/upstreamError.js';
import { JiraApiError } from '../../src/server/clients/jiraClient.js';
import { OnshapeApiError } from '../../src/server/clients/onshapeClient.js';
import { badRequest } from '../../src/server/middleware/httpError.js';

describe('describeUpstreamError', () => {
  it('describes a tracker 503 as not responding', () => {
    expect(describeUpstreamError(new JiraApiError('Service Unavailable', 503, 'x')))
      .toBe("the team tracker didn't respond (503)");
  });

  it('describes a tracker network failure (status 0) as no connection', () => {
    expect(describeUpstreamError(new JiraApiError('ECONNRESET', 0, 'x')))
      .toBe("the team tracker didn't respond (no connection)");
  });

  it('describes a tracker 400 as a refusal', () => {
    expect(describeUpstreamError(new JiraApiError('Field x is invalid', 400, 'x')))
      .toBe('the team tracker refused the change (400)');
  });

  it('describes any OnShape error as not responding', () => {
    expect(describeUpstreamError(new OnshapeApiError('Not found', 404, 'x')))
      .toBe("OnShape didn't respond (404)");
  });

  it('passes our own HttpError message through', () => {
    expect(describeUpstreamError(badRequest('Material "Steel" is not allowed')))
      .toBe('Material "Steel" is not allowed');
  });

  it('calls a TypeError from our own code an internal error, never "no connection"', () => {
    expect(describeUpstreamError(new TypeError('x is not a function')))
      .toBe('ValorBOM hit an internal error');
  });
});

describe('isNetworkError', () => {
  it.each(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'])('is true for a socket error %s', (code) => {
    expect(isNetworkError(Object.assign(new Error(code), { code }))).toBe(true);
  });

  it('is true for a real axios error with no response', () => {
    // Guards the isAxiosError flag against the library itself.
    expect(isNetworkError(new AxiosError('timeout', AxiosError.ECONNABORTED))).toBe(true);
  });

  it('is false for a TypeError or a plain Error', () => {
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false);
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });
});
