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

// Ends at anything but a letter or digit, so "am-3945_blue" (a colour variant) reads as AM-3945.
const PREFIXED_RE = /\b(WCP|TTB|REV|AM)-(\d[\d-]*\d|\d)(?![A-Za-z0-9])/i;
/** McMaster-Carr catalog numbers: "91251A540". */
const MCMASTER_RE = /^\d{4,5}[A-Z]\d{1,4}$/;
/** VEXpro part numbers: "217-2737". */
const VEX_RE = /^217-\d{4}$/;
/** CTR Electronics part numbers: "24-676873". */
const CTRE_RE = /^\d{2}-\d{6}$/;

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
  // Unprefixed numbers only when they are the whole cell: "217-2737", not a number inside a name.
  const whole = value.toUpperCase();
  if (MCMASTER_RE.test(whole)) return { sku: whole, vendor: 'McMaster-Carr' };
  if (VEX_RE.test(whole)) return { sku: whole, vendor: 'VEX' };
  if (CTRE_RE.test(whole)) return { sku: whole, vendor: 'CTR Electronics' };
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
    case 'VEX': return `https://www.vexrobotics.com/${lower}.html`;
    default: return null;
  }
}
