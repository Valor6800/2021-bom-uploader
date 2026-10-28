/**
 * Vendor name normalization.
 *
 * The Jira Vendor field is free text, and 1074 historical tickets carry ~68
 * distinct spellings for ~40 real vendors ("McMaster", "Mcmaster",
 * "McMaster-Carr", "McMaster Carr", "mcmaster", "MCM", "MMC"). Grouping on the
 * raw string would scatter a single vendor's order across six groups and
 * defeat the whole point of vendor-batched submission and check-in.
 *
 * We normalize for grouping and display only — the Jira field is never
 * rewritten, and the raw value is always carried alongside so the UI can show
 * what the requester actually typed.
 */

/**
 * Maps a collapsed key (lowercased, non-alphanumerics stripped) to the
 * canonical display name. Built from the observed spellings in PARTS.
 *
 * These names are also what gets written to the Orders sheet's Vendor column,
 * and the Overview tab's voucher tracking matches that column *exactly*:
 *   SUMIFS(Orders!N:N, Orders!A:A, "Voucher", Orders!D:D, <vendor label>)
 * So for any vendor that has a voucher row, the canonical name here has to be
 * spelled the way that row is spelled — "Thrifty", "Rev" and "Andymark" rather
 * than the prettier "Thrifty Bot", "REV Robotics", "AndyMark" — or voucher
 * spend silently fails to register against its allocation.
 */
const CANONICAL_BY_KEY = new Map(Object.entries({
  // West Coast Products
  wcp: 'WCP',
  westcoastproducts: 'WCP',
  // McMaster-Carr
  mcmaster: 'McMaster-Carr',
  mcmastercarr: 'McMaster-Carr',
  mcm: 'McMaster-Carr',
  mmc: 'McMaster-Carr',
  // Amazon
  amazon: 'Amazon',
  amazoncom: 'Amazon',
  // The Thrifty Bot — spelled to match the Overview voucher row.
  thriftybot: 'Thrifty',
  thrifty: 'Thrifty',
  ttb: 'Thrifty',
  thrifybot: 'Thrifty',
  // REV Robotics — spelled to match the Overview voucher row.
  rev: 'Rev',
  revrobotics: 'Rev',
  // CTR Electronics
  ctre: 'CTR Electronics',
  ctrelectronics: 'CTR Electronics',
  // VEX
  vex: 'VEX',
  vexpro: 'VEX',
  // AndyMark — spelled to match the Overview voucher row.
  andymark: 'Andymark',
  // DigiKey
  digikey: 'DigiKey',
  // Powerwerx
  powerwerx: 'Powerwerx',
  powerwerks: 'Powerwerx',
  // Home Depot
  homedepot: 'Home Depot',
  homedepoteverbilt: 'Home Depot',
  // Harbor Freight
  harborfreight: 'Harbor Freight',
  // Uline
  uline: 'Uline',
  // Prismatic Powders
  prismaticpowders: 'Prismatic Powders',
  // Others seen in the data with a single spelling, listed so the canonical
  // casing is stable regardless of how it was typed.
  titanrig: 'Titan Rig',
  fabworks: 'Fabworks',
  shars: 'Shars',
  tormach: 'Tormach',
  tekton: 'Tekton',
  lairdplastics: 'Laird Plastics',
  grainger: 'Grainger',
  monoprice: 'Monoprice',
  walmart: 'Walmart',
  mdpc: 'MDPC',
  cricut: 'Cricut',
  polymaker: 'Polymaker',
  markforged: 'Markforged',
  bambulabs: 'Bambu Labs',
  swagoffroad: 'Swag Off Road',
  seattlefabrics: 'Seattle Fabrics',
  metalsupermarkets: 'Metal Supermarkets',
  vistaprint: 'Vistaprint',
  oracal: 'Oracal',
  cogsdill: 'Cogsdill',
  flextail: 'Flextail',
  onlinemetals: 'Online Metals',
  westbrook: 'Westbrook',
  swyft: 'Swyft',
  '3dxtech': '3DXTech',
}));

/** Shown when the Vendor field is empty or holds something unusable. */
export const UNKNOWN_VENDOR = 'Unknown vendor';

/**
 * Collapse a raw vendor string to a lookup key: lowercase, alphanumerics only.
 * @param {*} raw
 * @returns {string}
 */
export function vendorKey(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns true when a raw vendor value is unusable as a vendor name — blank,
 * or a stray number (the data contains "25.99" and "15.99" where someone put
 * a price in the vendor field).
 *
 * @param {*} raw
 * @returns {boolean}
 */
export function isUnusableVendor(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return true;
  return /^[\d.,$]+$/.test(trimmed);
}

/**
 * Normalize a raw Jira Vendor value to a canonical display name.
 *
 * Unrecognized vendors are returned trimmed but otherwise untouched, so a new
 * vendor still groups correctly with itself and simply isn't re-cased.
 *
 * @param {*} raw  Raw Jira Vendor field value
 * @returns {string} Canonical vendor name, or UNKNOWN_VENDOR
 */
export function normalizeVendor(raw) {
  if (isUnusableVendor(raw)) return UNKNOWN_VENDOR;

  const key = vendorKey(raw);
  const canonical = CANONICAL_BY_KEY.get(key);
  if (canonical) return canonical;

  return String(raw).trim();
}

/**
 * Group items by canonical vendor.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => *} getRawVendor  Extracts the raw vendor value
 * @returns {{ vendor: string, items: T[] }[]} Groups, vendor-name ascending
 */
export function groupByVendor(items, getRawVendor) {
  const groups = new Map();

  for (const item of items) {
    const vendor = normalizeVendor(getRawVendor(item));
    if (!groups.has(vendor)) groups.set(vendor, []);
    groups.get(vendor).push(item);
  }

  return [...groups.entries()]
    .map(([vendor, groupItems]) => ({ vendor, items: groupItems }))
    .sort((a, b) => a.vendor.localeCompare(b.vendor));
}
