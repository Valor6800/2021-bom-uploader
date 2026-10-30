/**
 * Shared error-handling middleware and API 404 handler.
 *
 * Centralizes the response shape that every route previously duplicated:
 *   { ...details, error: <message>, status: <code>, source? }
 *
 * `details` come from an HttpError; `source` is 'tracker' for a
 * JiraApiError and 'onshape' for an OnshapeApiError.
 *
 * Reads `.status` off the thrown error (HttpError, JiraApiError,
 * OnshapeApiError all expose it) and defaults to 500. Logs 5xx errors.
 */

/** 404 handler for unknown /api routes (mount before the error handler). */
export function apiNotFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}`, status: 404 });
}

/**
 * Express error-handling middleware. Must be registered last, with all four
 * args so Express recognizes it as an error handler.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  }

  // Avoid double-sending if headers already went out (e.g. streamed binary).
  if (res.headersSent) {
    return next(err);
  }

  // `details` go first so they can never overwrite error, status or source.
  const source = errorSource(err);
  res.status(status).json({
    ...(err.details ?? {}),
    error: err.message || 'Internal Server Error',
    status,
    ...(source && { source }),
  });
}

/**
 * Which upstream system an error came from, so the client can choose its
 * wording without matching message text. Our own errors have no source.
 */
function errorSource(err) {
  if (err?.name === 'JiraApiError') return 'tracker';
  if (err?.name === 'OnshapeApiError') return 'onshape';
  return null;
}
