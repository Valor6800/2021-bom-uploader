/**
 * Search and grouping for the check-in page.
 *
 * Written for someone standing over an open box with a part in their hand.
 * They know one of three things — what is printed on the bag (a part number),
 * what the thing is called, or who asked for it — and they need to find out
 * where it goes. So search spans all of those fields at once rather than
 * making them pick a column, and grouping can be flipped between the three
 * questions that actually get asked:
 *
 *   by vendor   — "what else is in this box?"
 *   by person   — "who do I hand this to?"
 *   by assembly — "which subsystem does this belong to?"
 */

export const GroupMode = Object.freeze({
  VENDOR: 'vendor',
  PERSON: 'person',
  ASSEMBLY: 'assembly',
});

export const GROUP_MODES = [
  { id: GroupMode.VENDOR, label: 'Box (vendor)' },
  { id: GroupMode.PERSON, label: 'Hand to' },
  { id: GroupMode.ASSEMBLY, label: 'Assembly' },
];

const UNASSIGNED_PERSON = 'Nobody listed';
const UNASSIGNED_ASSEMBLY = 'No assembly set';

/**
 * Everything a ticket can be found by. Part numbers are matched both as typed
 * and with separators stripped, because the number printed on a bag is rarely
 * punctuated the way Jira holds it (`WCP-1713` vs `wcp1713`).
 *
 * @param {object} ticket
 * @returns {string}
 */
export function searchableText(ticket) {
  const partNumber = String(ticket.partNumber ?? '');

  return [
    ticket.key,
    ticket.summary,
    partNumber,
    partNumber.replace(/[^a-zA-Z0-9]/g, ''),
    ticket.vendor,
    ticket.vendorRaw,
    ticket.requestedBy?.displayName,
    ticket.requestedBy?.name,
    ticket.assembly?.name,
    ticket.assembly?.key,
    ticket.classification,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Filter tickets by a free-text query.
 *
 * All whitespace-separated terms must match somewhere, so `wcp reamer` narrows
 * rather than widens. An empty query returns everything.
 *
 * @param {object[]} tickets
 * @param {string} query
 * @returns {object[]}
 */
export function filterTickets(tickets, query) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tickets;

  return tickets.filter((ticket) => {
    const haystack = searchableText(ticket);
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * The label a ticket groups under in a given mode.
 *
 * @param {object} ticket
 * @param {string} mode
 * @returns {string}
 */
export function groupLabel(ticket, mode) {
  if (mode === GroupMode.PERSON) {
    return ticket.requestedBy?.displayName || UNASSIGNED_PERSON;
  }
  if (mode === GroupMode.ASSEMBLY) {
    // A sheet-only row has no epic, but its sheet Classification is a rough
    // destination and beats showing nothing.
    return ticket.assembly?.name || ticket.classification || UNASSIGNED_ASSEMBLY;
  }
  return ticket.vendor || 'Unknown vendor';
}

/**
 * Group tickets for display.
 *
 * Groups are ordered largest-first — the big box is the one being worked
 * through — with the "nothing set" bucket pushed to the end so it never leads.
 *
 * @param {object[]} tickets
 * @param {string} mode
 * @returns {{ label: string, mode: string, items: object[], trackingNumbers: string[],
 *   sheetRows: number[], needsAttention: number }[]}
 */
export function groupTickets(tickets, mode) {
  const groups = new Map();

  for (const ticket of tickets) {
    const label = groupLabel(ticket, mode);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(ticket);
  }

  const placeholders = new Set([UNASSIGNED_PERSON, UNASSIGNED_ASSEMBLY, 'Unknown vendor']);

  return [...groups.entries()]
    .map(([label, items]) => ({
      label,
      mode,
      items,
      trackingNumbers: [...new Set(items.map((t) => t.trackingNumber).filter(Boolean))],
      sheetRows: items.map((t) => t.sheetRow).filter((r) => r !== null).sort((a, b) => a - b),
      needsAttention: items.filter(
        (t) => t.outcome === 'attention' || t.outcome === 'drift',
      ).length,
    }))
    .sort((a, b) => {
      const aPlaceholder = placeholders.has(a.label);
      const bPlaceholder = placeholders.has(b.label);
      if (aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      return a.label.localeCompare(b.label);
    });
}
