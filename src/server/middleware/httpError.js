/**
 * HttpError — an Error carrying an HTTP status code.
 *
 * Route handlers and services can throw this (e.g. for validation failures)
 * and the shared error handler will map it to the right response status.
 * Client errors (JiraApiError / OnshapeApiError) already expose `.status`,
 * so the error handler reads `.status` generically.
 */

/**
 * Keys the error handler writes itself. A detail with one of these names
 * would be silently replaced in the response body, so it is refused here.
 */
const RESERVED_DETAIL_KEYS = ['error', 'status', 'source', 'internal'];

export class HttpError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} message Human-readable message
   * @param {object} [details] Extra fields spread into the JSON error body
   */
  constructor(status, message, details) {
    if (details) {
      const reserved = RESERVED_DETAIL_KEYS.find((k) => Object.hasOwn(details, k));
      if (reserved) {
        throw new Error(`HttpError details may not use reserved key '${reserved}'`);
      }
    }
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details) this.details = details;
  }
}

/** Convenience for 400 Bad Request. */
export function badRequest(message, details) {
  return new HttpError(400, message, details);
}

/** Convenience for 409 Conflict. */
export function conflict(message, details) {
  return new HttpError(409, message, details);
}
