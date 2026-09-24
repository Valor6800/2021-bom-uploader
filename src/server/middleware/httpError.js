/**
 * HttpError — an Error carrying an HTTP status code.
 *
 * Route handlers and services can throw this (e.g. for validation failures)
 * and the shared error handler will map it to the right response status.
 * Client errors (JiraApiError / OnshapeApiError) already expose `.status`,
 * so the error handler reads `.status` generically.
 */
export class HttpError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} message Human-readable message
   */
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Convenience for 400 Bad Request. */
export function badRequest(message) {
  return new HttpError(400, message);
}
