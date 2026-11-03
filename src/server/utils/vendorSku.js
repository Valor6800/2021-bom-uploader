/**
 * Vendor part numbers (SKUs) on off-the-shelf BOM rows.
 *
 * A vendor's OnShape part carries its SKU in the Part number cell
 * ("WCP-1706"), or only in its name ("WCP-1109-001 Rev1"). Pure.
 */

/** Prefixed SKUs: prefix -> vendor (spelled as `vendorNormalize` spells it). */
const PREFIXES = Object.freeze({
  WCP: 'WCP',
  TTB: 'Thrifty',
  REV: 'Rev',
  AM: 'Andymark',
});

const PREFIXED_RE = /\b(WCP|TTB|REV|AM)-(\d[\d-]*\d|\d)\b/i;
/** McMaster-Carr catalog numbers: "91251A540". */
const MCMASTER_RE = /^\d{4,5}[A-Z]\d{1,4}$/;

/** A string that is safe to search for and to put in a URL path. */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/**
 * @param {string} text
 * @returns {{ sku: string, vendor: string } | null}
 */
function fromText(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const match = PREFIXED_RE.exec(value);
  if (match) {
    const prefix = match[1].toUpperCase();
    // WCP part numbers are WCP-XXXX; anything after ("WCP-1109-001") is a variant or file suffix.
    if (prefix === 'WCP') {
      const wcp = /^(\d{4})/.exec(match[2]);
      return wcp ? { sku: `WCP-${wcp[1]}`, vendor: 'WCP' } : null;
    }
    return { sku: `${prefix}-${match[2]}`, vendor: PREFIXES[prefix] };
  }
  if (MCMASTER_RE.test(value.toUpperCase())) return { sku: value.toUpperCase(), vendor: 'McMaster-Carr' };
  return null;
}

/**
 * The SKU of a BOM row: its Part number first, then its name, then its description.
 *
 * @param {{ partNumber?: string, name?: string, description?: string }} row
 * @returns {{ sku: string, vendor: string } | null}
 */
export function skuOf(row) {
  return fromText(row?.partNumber) ?? fromText(row?.name) ?? fromText(row?.description);
}

/**
 * A vendor's public product page for a SKU, when the address can be built
 * from the SKU alone. Null otherwise.
 *
 * @param {{ sku: string, vendor: string }} found
 * @returns {string|null}
 */
export function productPageOf({ sku, vendor }) {
  if (!SKU_PATTERN.test(sku)) return null;
  const lower = sku.toLowerCase();
  switch (vendor) {
    case 'WCP': return `https://wcproducts.com/products/${lower}`;
    case 'Rev': return `https://www.revrobotics.com/${lower}/`;
    case 'Andymark': return `https://andymark.com/products/${lower}`;
    case 'McMaster-Carr': return `https://www.mcmaster.com/${sku}/`;
    default: return null;
  }
}
