/**
 * Words for Parts that lack some of the cut's files. Pure, so the
 * server-side Jest suite tests it.
 */

/**
 * @param {{ fullPartNumber?: string, key: string, filesMissing: string[] }[]} parts
 * @returns {string}
 */
export function missingText(parts) {
  const named = parts.map((p) => `${p.fullPartNumber ?? p.key} (${p.filesMissing.join(', ')})`);
  const shown = named.length > 4 ? [...named.slice(0, 4), `${named.length - 4} more`] : named;
  return `${parts.length === 1 ? '1 Part is' : `${parts.length} Parts are`} missing files: ${shown.join(', ')}.`;
}
