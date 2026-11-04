/**
 * Display helpers for the past-orders page.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

/**
 * `2026-10-29` -> `Thu, Oct 29, 2026`.
 *
 * Formatted in UTC because the value is a calendar date, not an instant:
 * reading it in local time would show the day before anywhere west of UTC.
 *
 * @param {string|null} isoDate
 * @returns {string}
 */
export function formatOrderDate(isoDate) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : DATE_FORMAT.format(date);
}
