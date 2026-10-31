/**
 * Wording for the sub-assemblies found when an assembly is added from
 * OnShape. A sub-assembly is an Assembly of its own, never a Part; each one
 * is checked against the tracker and only the missing ones are created.
 *
 * Statuses: `new` (preview: will be created), `created`, `exists`,
 * `conflict` (its number belongs to a different OnShape assembly),
 * `problems` (its OnShape properties are incomplete) and `error`.
 */

/** "VF27A-1100A Intake", or just the name when no number is known yet. */
export function subLabel(sub) {
  return sub.assembly?.summary ?? sub.proposed?.summary ?? sub.name ?? 'Sub-assembly';
}

function problemNames(sub) {
  const names = (sub.problems ?? []).map((p) => p.property);
  return names.length ? names.join(', ') : null;
}

/**
 * One line for one sub-assembly.
 * @param {object} sub
 * @param {{ preview?: boolean }} [options]  `preview` uses "will be created"
 */
export function describeSubAssembly(sub, { preview = false } = {}) {
  const label = subLabel(sub);
  switch (sub.status) {
    case 'new':
      return `${label}: will be created`;
    case 'revision':
      return `${label}: will be created as the next Revision of ${sub.previous?.summary ?? 'the earlier one'}`;
    case 'created':
      return `${label}: created${sub.assembly?.key ? ` (${sub.assembly.key})` : ''}${sub.revisionOf ? `, next Revision of ${sub.revisionOf.key}` : ''}`;
    case 'exists':
      return `${label}: already exists${sub.assembly?.key ? ` (${sub.assembly.key})` : ''}${preview ? ', so it will not be created again' : ', not created again'}`;
    case 'conflict':
      return `${label}: skipped, its number already belongs to ${sub.assembly?.key ?? 'another Assembly'}`;
    case 'problems': {
      const names = problemNames(sub);
      return `${label}: skipped, ${names ? `fill in ${names} in OnShape` : (sub.message ?? 'its OnShape properties are incomplete')}`;
    }
    default:
      return `${label}: ${preview ? "couldn't be checked" : "wasn't created"}${sub.message ? `: ${sub.message}` : ''}`;
  }
}

/** How many of the sub-assemblies will be (preview) or were (result) created. */
export function countCreated(subs, { preview = false } = {}) {
  return (subs ?? []).filter((s) => (preview ? s.status === 'new' || s.status === 'revision' : s.status === 'created')).length;
}

/** True when any sub-assembly is something the student should read about. */
export function hasSubAssemblies(subs) {
  return Array.isArray(subs) && subs.length > 0;
}
