/**
 * Presentation-level business rules for part rows. Kept separate from the
 * table/row components so the rules are testable and reusable.
 */

/** Powdercoat only applies to AL 6061 parts. */
export function isPowdercoatEnabled(material) {
  return Boolean(material && material.includes('AL 6061'));
}

/** Thickness applies to sheet/plate-like materials. */
export function isThicknessEnabled(material) {
  return Boolean(
    material &&
      (material.includes('AL 6061') ||
        material.includes('Polycarb') ||
        material.includes('Wood') ||
        material.includes('SRPP')),
  );
}

/** A part that will trigger an automatic STEP export on save. */
export function isStepAutoExport(story) {
  return story._status === 'New' && story.machinery === '3D Printer';
}
