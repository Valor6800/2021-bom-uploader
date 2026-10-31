/**
 * Student-facing text for an error on one item of a multi-item request
 * (a Build save, a Build clone, onboarding's Build 1). Callers prefix it,
 * e.g. "Created, but not added to Build 1: the team tracker didn't respond (503)."
 *
 * Chooses the wording from the error's class and status, never its message
 * text. Our own HttpError and validation messages are already student copy,
 * so they pass through unchanged. Any other error is a bug in ValorBOM
 * itself (a TypeError, a bad argument), so it is never blamed on the
 * tracker or OnShape.
 */

/** Socket and DNS error codes that mean the upstream really didn't answer. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ERR_NETWORK',
]);

/**
 * True for an HTTP client error that never got a response: an axios error,
 * or any error carrying a socket/DNS code. A TypeError from our own code is
 * not one.
 *
 * @param {Error & { code?: string, isAxiosError?: boolean }} err
 * @returns {boolean}
 */
export function isNetworkError(err) {
  return err?.isAxiosError === true || NETWORK_ERROR_CODES.has(err?.code);
}

/**
 * @param {Error & { status?: number }} err
 * @returns {string}
 */
export function describeUpstreamError(err) {
  const status = err?.status ?? 0;
  if (err?.name === 'JiraApiError') {
    if (status >= 500 || status === 0) {
      return `the team tracker didn't respond (${status === 0 ? 'no connection' : status})`;
    }
    return `the team tracker refused the change (${status})`;
  }
  if (err?.name === 'OnshapeApiError') {
    if (status === 401 || status === 403) return `OnShape refused the change (${status})`;
    return `OnShape didn't respond (${status === 0 ? 'no connection' : status})`;
  }
  if (err?.name === 'HttpError') return err.message;
  return 'ValorBOM hit an internal error';
}

/**
 * Which upstream system an error came from: 'tracker' for a JiraApiError,
 * 'onshape' for an OnshapeApiError, null for our own errors.
 *
 * @param {Error} err
 * @returns {'tracker'|'onshape'|null}
 */
export function upstreamSource(err) {
  if (err?.name === 'JiraApiError') return 'tracker';
  if (err?.name === 'OnshapeApiError') return 'onshape';
  return null;
}
