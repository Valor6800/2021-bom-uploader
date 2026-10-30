import { describeUpstreamError } from '../../src/server/utils/upstreamError.js';
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
});
