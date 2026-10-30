/**
 * Client copy of the server's per-item field checks for a Build save
 * (BuildService fieldProblem, validatePartPayload), so a row that would be
 * refused is held back and marked before Save is pressed.
 *
 * Uses the constants mirrored in api/client.js; a Jest parity test compares
 * it with the server's validatePartPayload so the two lists can't drift.
 */
import { MATERIALS, MACHINERY, POWDERCOAT, THICKNESS } from '../api/client.js';

const LISTS = [
  ['material', 'material', MATERIALS],
  ['machinery', 'machinery', MACHINERY],
  ['powdercoat', 'powdercoat', POWDERCOAT],
  ['thickness', 'thickness', THICKNESS],
];

const PART_NUMBER_RE = /^V[RF]\d{2}P-\d{4}([A-Z])/;

/**
 * The first field that fails, as `{ field, error }`, or null.
 * Checked in the server's order: material, machinery, powdercoat,
 * thickness, quantity, then (creates) revision.
 *
 * @param {{ material: string, machinery: string, powdercoat?: string, thickness?: string,
 *   quantity: number, revision?: string, summary?: string }} row
 */
export function validateRowFields(row) {
  const values = {
    ...row,
    powdercoat: row.powdercoat ?? 'None',
    thickness: row.thickness ?? 'None',
  };
  for (const [field, label, list] of LISTS) {
    if (!list.includes(values[field])) {
      return { field, error: `"${values[field] ?? ''}" isn't on the ${label} list. Pick one.` };
    }
  }
  if (!Number.isInteger(values.quantity) || values.quantity < 1) {
    return { field: 'quantity', error: 'Quantity must be a whole number of 1 or more.' };
  }
  if (values.revision !== undefined && values.revision !== null) {
    if (typeof values.revision !== 'string' || !/^[A-Z]$/.test(values.revision)) {
      return { field: 'revision', error: 'Revision must be one capital letter.' };
    }
    const letter = PART_NUMBER_RE.exec(values.summary ?? '')?.[1];
    if (letter && letter !== values.revision) {
      return {
        field: 'revision',
        error: `Revision ${values.revision} doesn't match the number's letter ${letter}.`,
      };
    }
  }
  return null;
}
