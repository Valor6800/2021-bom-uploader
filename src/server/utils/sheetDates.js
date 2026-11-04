/**
 * Google Sheets date serials.
 *
 * A date cell holds a day count from 1899-12-30 (the Lotus 1-2-3 epoch Sheets
 * inherited), with the date shown only through the cell's number format. The
 * Orders tab's order-date rows are written and read this way, so the dates
 * sort and filter as dates in the sheet rather than as text.
 */

const EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {number} serial  Sheets date serial (fractions are time of day)
 * @returns {string|null}  `YYYY-MM-DD`, or null when not a plausible date
 */
export function serialToIsoDate(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  return new Date(EPOCH_UTC + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @param {string} isoDate  `YYYY-MM-DD`
 * @returns {number} Sheets date serial
 */
export function isoDateToSerial(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - EPOCH_UTC) / DAY_MS);
}

/**
 * Parse a date someone typed as text, e.g. `10/29/2026` — the format the sheet
 * displays, so it is what a person retyping a date by hand would enter.
 *
 * @param {string} text
 * @returns {string|null} `YYYY-MM-DD`
 */
export function textToIsoDate(text) {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(text ?? ''));
  if (!match) return null;

  const [, month, day, year] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Today's calendar date in a given time zone. Uses the spreadsheet's zone
 * rather than the server's, so an order cut in the evening is not stamped
 * with tomorrow's date by a UTC host.
 *
 * @param {string|null} [timeZone]
 * @param {Date} [now]
 * @returns {string} `YYYY-MM-DD`
 */
export function todayIsoDate(timeZone, now = new Date()) {
  const format = (zone) => new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  try {
    return format(timeZone || undefined);
  } catch {
    // An unrecognized zone name should not block an order from being written.
    return format(undefined);
  }
}
