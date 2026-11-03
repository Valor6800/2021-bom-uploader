/**
 * Turn an error from api/client.js into student-facing text.
 *
 * Wording is chosen from structured data only (`err.body.source` set by the
 * server's errorHandler, and `err.status`), never by matching message text.
 * Callers add the action prefix, e.g. "Couldn't load Assemblies: " +
 * friendlyError(err).
 *
 * Pure: no imports, so the server-side Jest suite can test it directly.
 */

/**
 * @param {Error & { status?: number, body?: { source?: string } }} err
 * @returns {string}
 */
export function friendlyError(err) {
  if (err?.name === 'ApiError') {
    const status = err.status ?? 0;
    const source = err.body?.source;
    if (source === 'tracker') {
      if (status >= 500 || status === 0) {
        return `The team tracker didn't respond (${status === 0 ? 'no connection' : status}).`;
      }
      return `The team tracker refused the change (${status}).`;
    }
    if (source === 'onshape') {
      if (status === 401 || status === 403) return `OnShape refused the change (${status}).`;
      return `OnShape didn't respond (${status === 0 ? 'no connection' : status}).`;
    }
    // The server threw an error with no status of its own: a ValorBOM bug.
    if (err.body?.internal) return INTERNAL;
    return err.message;
  }
  // Every page needs a team sign-in, so a 401 mid-session means it expired;
  // a reload goes through sign-in and back to the same page. A 403 says why.
  if (err?.name === 'AuthRequiredError') {
    return err.forbidden ? err.message : 'Your sign-in has expired. Reload the page to sign in again.';
  }
  // fetch() itself threw: the local ValorBOM server is unreachable.
  if (err?.name === 'NetworkError') return "Couldn't reach ValorBOM. Is the server running?";
  // Anything else was thrown by our own browser code.
  return INTERNAL;
}

const INTERNAL = 'ValorBOM hit an internal error.';

/**
 * friendlyError for use after an action prefix and a colon:
 * "Couldn't load the Builds: the team tracker didn't respond (503)."
 * Only the leading "The" is lowered; names like OnShape keep their case.
 *
 * @param {Error} err
 * @returns {string}
 */
export function friendlyClause(err) {
  return friendlyError(err).replace(/^The /, 'the ');
}
