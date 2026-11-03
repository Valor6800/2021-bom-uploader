/**
 * Powdercoat from a part's colour in OnShape. Students rarely type the exact
 * colour, so each colour is judged by its lightness and hue, with room around
 * the ideal: any dark colour is Black, and a yellow-orange of decent strength
 * is Gold. Everything else (OnShape's default grey, white, red, blue ...) is
 * not a powdercoat.
 */

import { Powdercoat } from './bomConstants.js';

/** At or below this lightness (0 black, 1 white) a colour reads as Black. */
export const BLACK_MAX_LIGHTNESS = 0.2;

/** Gold: a hue (degrees) between orange and yellow, strong enough not to be grey or khaki. */
export const GOLD_HUE = { min: 38, max: 54 };
export const GOLD_MIN_SATURATION = 0.45;
export const GOLD_LIGHTNESS = { min: 0.3, max: 0.8 };

/** @returns {{ h: number, s: number, l: number }}  h in degrees, s and l from 0 to 1 */
export function toHsl({ red, green, blue }) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/**
 * @param {{ color?: { red: number, green: number, blue: number } }|null|undefined} appearance
 *   A BOM row's appearance
 * @returns {string} A Powdercoat value: Black, Gold or None
 */
export function powdercoatFromAppearance(appearance) {
  const color = appearance?.color;
  if (![color?.red, color?.green, color?.blue].every(Number.isFinite)) return Powdercoat.NONE;
  const { h, s, l } = toHsl(color);
  if (l <= BLACK_MAX_LIGHTNESS) return Powdercoat.BLACK;
  if (h >= GOLD_HUE.min && h <= GOLD_HUE.max && s >= GOLD_MIN_SATURATION
    && l >= GOLD_LIGHTNESS.min && l <= GOLD_LIGHTNESS.max) return Powdercoat.GOLD;
  return Powdercoat.NONE;
}
