/**
 * Names typed in OnShape sometimes carry a bracketed tag, like
 * "[1300] Electrical". The tracker name drops it: "Electrical".
 *
 * Every [...] group is removed and spaces are tidied. A name that is nothing
 * but brackets keeps the text inside them, so a name is never left empty.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function stripBrackets(name) {
  const text = typeof name === 'string' ? name : '';
  const cleaned = text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned) return cleaned;
  return text.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}
