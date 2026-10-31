/**
 * Validators — field-level and payload-level validation for BOM part data.
 * All allowed-value checks reference the centralized BOM constants.
 */

import { MATERIALS, MACHINERY, POWDERCOAT, THICKNESS } from './bomConstants.js';

/**
 * @param {string} value
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMaterial(value) {
  if (!MATERIALS.includes(value)) {
    return { valid: false, error: `Invalid material "${value}". Allowed: ${MATERIALS.join(', ')}` };
  }
  return { valid: true };
}

/**
 * @param {string} value
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMachinery(value) {
  if (!MACHINERY.includes(value)) {
    return { valid: false, error: `Invalid machinery "${value}". Allowed: ${MACHINERY.join(', ')}` };
  }
  return { valid: true };
}

/**
 * @param {string} value
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePowdercoat(value) {
  if (!POWDERCOAT.includes(value)) {
    return { valid: false, error: `Invalid powdercoat "${value}". Allowed: ${POWDERCOAT.join(', ')}` };
  }
  return { valid: true };
}

/**
 * @param {string} value
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateThickness(value) {
  if (!THICKNESS.includes(value)) {
    return { valid: false, error: `Invalid thickness "${value}". Allowed: ${THICKNESS.join(', ')}` };
  }
  return { valid: true };
}

/**
 * @param {*} value
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateQuantity(value) {
  if (!Number.isInteger(value) || value < 1) {
    return { valid: false, error: `Quantity must be a positive integer, got "${value}"` };
  }
  return { valid: true };
}

/**
 * Validate all fields on a part payload.
 * @param {{ material: string, machinery: string, powdercoat: string, thickness: string, quantity: number }} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePartPayload(payload) {
  const errors = [];

  const checks = [
    validateMaterial(payload.material),
    validateMachinery(payload.machinery),
    validatePowdercoat(payload.powdercoat),
    validateThickness(payload.thickness),
    validateQuantity(payload.quantity),
  ];

  for (const result of checks) {
    if (!result.valid) {
      errors.push(result.error);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Shape of a tracker key, e.g. "HAR-2030". */
export const KEY_RE = /^[A-Z][A-Z0-9_]*-\d{1,7}$/;

/**
 * Validate a tracker key: the KEY_RE shape plus a project prefix equal to
 * the configured project. The project is read at call time, so a
 * PROJECT_KEY set after import (tests, fixture generator) is honoured.
 *
 * @param {*} key
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateIssueKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return { valid: false, error: `"${String(key).slice(0, 40)}" is not a valid key` };
  }
  const project = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';
  const prefix = key.slice(0, key.lastIndexOf('-'));
  if (prefix !== project) {
    return { valid: false, error: `"${key}" is not in project ${project}` };
  }
  return { valid: true };
}

/**
 * Sanitize a string for safe inclusion in a JQL query.
 * Prevents JQL injection by escaping reserved characters and
 * removing control characters.
 * @param {string} input
 * @returns {string}
 */
export function sanitizeJQL(input) {
  if (typeof input !== 'string') return '';

  // Strip control characters
  let sanitized = input.replace(/[\x00-\x1f\x7f]/g, '');

  // Escape JQL reserved characters: \ " ' ( ) [ ] { }
  sanitized = sanitized.replace(/([\\"'()\[\]{}])/g, '\\$1');

  return sanitized;
}
