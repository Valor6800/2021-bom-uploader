/**
 * Shared error-handling middleware and API 404 handler.
 *
 * Centralizes the response shape that every route previously duplicated:
 *   { ...details, error: <message>, status: <code>, source?, internal? }
 *
 * `details` come from an HttpError; `source` is 'tracker' for a
 * JiraApiError and 'onshape' for an OnshapeApiError; `internal: true`
 * marks an error that carries no status (a bug in ValorBOM itself).
 *
 * Reads `.status` off the thrown error (HttpError, JiraApiError,
 * OnshapeApiError all expose it) and defaults to 500. Logs 5xx errors.
 */

import { upstreamSource } from '../utils/upstreamError.js';

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

  // Jira's own reason for a refusal stays in the server log.
  if (err.jiraErrors && status < 500) {
    console.warn(`Tracker refused ${req.method} ${req.originalUrl}:`, err.status,
      JSON.stringify(err.jiraErrors));
  }

  // `details` go first so they can never overwrite error, status or source.
  // An error with no status of its own is a bug in ValorBOM (a TypeError,
  // a bad argument), flagged `internal` so the browser doesn't blame the
  // tracker, OnShape or the network.
  const source = upstreamSource(err);
  const internal = !err.status && !source;
  res.status(status).json({
    ...(err.details ?? {}),
    error: err.message || 'Internal Server Error',
    status,
    ...(source && { source }),
    ...(internal && { internal: true }),
  });
}

