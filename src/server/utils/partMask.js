/**
 * Part Mask Parser — extracts structured data from ValorBOM part number
 * naming conventions. Replaces the static applyTitleMask and applyPartMask
 * methods from the monolithic ValorBOM class.
 *
 * Epic (title) pattern:  V[RF]\d{2}A-\d{4} Name
 * Part pattern:          V[RF]\d{2}P-\d{4}[A-Z] Name
 */

const TITLE_REGEX = /V([RF])(\d{2})([AP])-(\d{4})(.*)/;
const PART_REGEX = /V([RF])(\d{2})([AP])-(\d{4})([A-Z])(.*)/;

/**
 * Parse an epic/title string matching V[RF]\d{2}[AP]-\d{4} Name.
 * @param {string} text
 * @returns {TitleMaskResult | null}
 */
export function applyTitleMask(text) {
  const matches = TITLE_REGEX.exec(text);
  if (!matches) return null;

  const [, seasonType, year, partType, partNumber, rawName] = matches;
  return {
    summary: text,
    name: rawName.trim(),
    year,
    seasonType,
    partNumber,
    fullPartNumber: text.split(' ')[0],
    isEpic: partType === 'A',
  };
}

/**
 * Parse a part string matching V[RF]\d{2}[AP]-\d{4}[A-Z] Name.
 * @param {string} text
 * @returns {PartMaskResult | null}
 */
export function applyPartMask(text) {
  const matches = PART_REGEX.exec(text);
  if (!matches) return null;

  const [, seasonType, year, partType, partNumber, version, rawName] = matches;
  return {
    summary: text,
    name: rawName.trim(),
    version,
    year,
    seasonType,
    partNumber,
    fullPartNumber: text.split(' ')[0],
    isEpic: partType === 'A',
  };
}

/**
 * Check whether a string is a valid part number (either epic or part pattern).
 * @param {string} text
 * @returns {boolean}
 */
export function isValidPartNumber(text) {
  return TITLE_REGEX.test(text);
}

/**
 * Format a parsed result back into a part number string (round-trip support).
 * Works with results from either applyTitleMask or applyPartMask.
 * @param {TitleMaskResult | PartMaskResult} parsed
 * @returns {string}
 */
export function formatPartNumber(parsed) {
  const type = parsed.isEpic ? 'A' : 'P';
  const base = `V${parsed.seasonType}${parsed.year}${type}-${parsed.partNumber}`;
  const version = parsed.version || '';
  const name = parsed.name ? ` ${parsed.name}` : '';
  return `${base}${version}${name}`;
}
