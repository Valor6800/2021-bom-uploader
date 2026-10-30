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
      return `OnShape didn't respond (${status === 0 ? 'no connection' : status}).`;
    }
    return err.message;
  }
  // A sign-in prompt already carries its own copy.
  if (err?.name === 'AuthRequiredError') return err.message;
  // fetch() itself threw: the local ValorBOM server is unreachable.
  return "Couldn't reach ValorBOM. Is the server running?";
}
