/**
 * Student-facing text for an error on one item of a multi-item request
 * (a Build save, a Build clone, onboarding's Build 1). Callers prefix it,
 * e.g. "Created, but not added to Build 1: the team tracker didn't respond (503)."
 *
 * Chooses the wording from the error's class and status, never its message
 * text. Our own HttpError and validation messages are already student copy,
 * so they pass through unchanged.
 */

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
    return `OnShape didn't respond (${status === 0 ? 'no connection' : status})`;
  }
  return err?.message ?? String(err);
}
