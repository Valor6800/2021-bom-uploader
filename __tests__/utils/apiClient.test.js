/**
 * api/client.js request(): which error class each failure becomes, since
 * friendlyError picks its wording from the class.
 */
import { jest } from '@jest/globals';
import {
  ApiError, AuthRequiredError, NetworkError, fetchEpicByKey,
} from '../../src/client/src/api/client.js';
import { friendlyError } from '../../src/client/src/lib/friendlyError.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function respond(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400, status, json: async () => body,
  });
}

describe('request() error classes', () => {
  it("keeps ValorBOM's own 401 as a sign-in prompt", async () => {
    respond(401, { error: 'Sign-in required', status: 401, loginUrl: '/auth/login' });
    await expect(fetchEpicByKey('HAR-1')).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('treats an OnShape 403 as an upstream refusal, not a sign-in prompt', async () => {
    respond(403, { error: 'Onshape refused access', status: 403, source: 'onshape' });
    const err = await fetchEpicByKey('HAR-1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.body.source).toBe('onshape');
    expect(friendlyError(err)).toBe('OnShape refused the change (403).');
  });

  it('treats a tracker 403 as the tracker refusing', async () => {
    respond(403, { error: 'Forbidden', status: 403, source: 'tracker' });
    const err = await fetchEpicByKey('HAR-1').catch((e) => e);
    expect(friendlyError(err)).toBe('The team tracker refused the change (403).');
  });

  it('turns a fetch() failure into NetworkError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await fetchEpicByKey('HAR-1').catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(friendlyError(err)).toBe("Couldn't reach ValorBOM. Is the server running?");
  });

  it('re-throws an AbortError unchanged so callers can ignore it', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    global.fetch = jest.fn().mockRejectedValue(abort);
    await expect(fetchEpicByKey('HAR-1')).rejects.toBe(abort);
  });
});
