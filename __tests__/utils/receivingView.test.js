/**
 * Search and grouping for the check-in page — the behaviour someone standing
 * over a box actually depends on.
 */
import {
  filterTickets,
  groupTickets,
  groupLabel,
  searchableText,
  GroupMode,
} from '../../src/client/src/lib/receivingView.js';

function ticket(overrides = {}) {
  return {
    key: 'PARTS-1',
    summary: 'WCP Swerve X2 Drive Double Gear',
    partNumber: 'WCP-1713',
    vendor: 'WCP',
    vendorRaw: 'WCP',
    qty: 4,
    sheetRow: 23,
    trackingNumber: null,
    outcome: 'in-sync',
    requestedBy: { name: 'olsen2826', displayName: 'Nik Olsen' },
    assembly: { key: 'HAR-1984', name: 'VF27-0200 Tooling' },
    ...overrides,
  };
}

describe('searchableText', () => {
  it('covers every field someone might search by', () => {
    const text = searchableText(ticket());

    expect(text).toContain('parts-1');
    expect(text).toContain('wcp swerve');
    expect(text).toContain('wcp-1713');
    expect(text).toContain('nik olsen');
    expect(text).toContain('olsen2826');
    expect(text).toContain('vf27-0200 tooling');
    expect(text).toContain('har-1984');
  });

  it('includes the part number with separators stripped', () => {
    // A bag is labelled "WCP1713" as often as "WCP-1713".
    expect(searchableText(ticket())).toContain('wcp1713');
  });

  it('survives missing fields', () => {
    expect(() => searchableText({ key: 'PARTS-2' })).not.toThrow();
  });
});

describe('filterTickets', () => {
  const tickets = [
    ticket({ key: 'PARTS-1', partNumber: 'WCP-1713', summary: 'Swerve gear' }),
    ticket({
      key: 'PARTS-2',
      partNumber: 'WCP-2570',
      summary: '.624" HSS Reamer',
      requestedBy: { name: 'macarroll', displayName: 'Matthew Carroll' },
      assembly: { key: 'HAR-3', name: '[9000] Controls' },
    }),
    ticket({
      key: 'PARTS-3',
      partNumber: null,
      summary: 'Tapping Arm',
      vendor: 'Amazon',
      vendorRaw: 'Amazon',
    }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterTickets(tickets, '')).toHaveLength(3);
    expect(filterTickets(tickets, '   ')).toHaveLength(3);
  });

  it('finds a part by its printed number', () => {
    expect(filterTickets(tickets, 'WCP-2570').map((t) => t.key)).toEqual(['PARTS-2']);
  });

  it('finds a part number typed without the dash', () => {
    expect(filterTickets(tickets, 'wcp2570').map((t) => t.key)).toEqual(['PARTS-2']);
  });

  it('is case-insensitive', () => {
    expect(filterTickets(tickets, 'reamer').map((t) => t.key)).toEqual(['PARTS-2']);
    expect(filterTickets(tickets, 'REAMER').map((t) => t.key)).toEqual(['PARTS-2']);
  });

  it('finds by person', () => {
    expect(filterTickets(tickets, 'matthew').map((t) => t.key)).toEqual(['PARTS-2']);
  });

  it('finds by assembly', () => {
    expect(filterTickets(tickets, 'controls').map((t) => t.key)).toEqual(['PARTS-2']);
  });

  it('finds by ticket key', () => {
    expect(filterTickets(tickets, 'parts-3').map((t) => t.key)).toEqual(['PARTS-3']);
  });

  it('narrows with multiple terms rather than widening', () => {
    expect(filterTickets(tickets, 'wcp reamer').map((t) => t.key)).toEqual(['PARTS-2']);
    expect(filterTickets(tickets, 'wcp tapping')).toEqual([]);
  });

  it('returns nothing for no match', () => {
    expect(filterTickets(tickets, 'zzzz')).toEqual([]);
  });
});

describe('groupLabel', () => {
  it('labels by vendor, person or assembly', () => {
    const t = ticket();
    expect(groupLabel(t, GroupMode.VENDOR)).toBe('WCP');
    expect(groupLabel(t, GroupMode.PERSON)).toBe('Nik Olsen');
    expect(groupLabel(t, GroupMode.ASSEMBLY)).toBe('VF27-0200 Tooling');
  });

  it('names the gaps rather than leaving them blank', () => {
    expect(groupLabel(ticket({ requestedBy: null }), GroupMode.PERSON)).toBe('Nobody listed');
    expect(groupLabel(ticket({ assembly: null }), GroupMode.ASSEMBLY)).toBe('No assembly set');
    expect(groupLabel(ticket({ vendor: null }), GroupMode.VENDOR)).toBe('Unknown vendor');
  });
});

describe('groupTickets', () => {
  const tickets = [
    ticket({ key: 'PARTS-1', vendor: 'WCP' }),
    ticket({ key: 'PARTS-2', vendor: 'WCP' }),
    ticket({ key: 'PARTS-3', vendor: 'Amazon' }),
  ];

  it('groups by the chosen mode', () => {
    const groups = groupTickets(tickets, GroupMode.VENDOR);

    expect(groups.map((g) => g.label)).toEqual(['WCP', 'Amazon']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].mode).toBe(GroupMode.VENDOR);
  });

  it('orders biggest group first — that is the box being worked through', () => {
    const groups = groupTickets(
      [...tickets, ticket({ key: 'PARTS-4', vendor: 'Amazon' }), ticket({ key: 'PARTS-5', vendor: 'Amazon' })],
      GroupMode.VENDOR,
    );

    expect(groups[0].label).toBe('Amazon');
    expect(groups[0].items).toHaveLength(3);
  });

  it('pushes the "nothing set" bucket to the end so it never leads', () => {
    const groups = groupTickets(
      [
        ticket({ key: 'PARTS-1', assembly: null }),
        ticket({ key: 'PARTS-2', assembly: null }),
        ticket({ key: 'PARTS-3', assembly: { key: 'HAR-3', name: '[9000] Controls' } }),
      ],
      GroupMode.ASSEMBLY,
    );

    expect(groups.map((g) => g.label)).toEqual(['[9000] Controls', 'No assembly set']);
  });

  it('collects tracking numbers and sheet rows per group', () => {
    const groups = groupTickets(
      [
        ticket({ key: 'PARTS-1', sheetRow: 25, trackingNumber: '1Z999' }),
        ticket({ key: 'PARTS-2', sheetRow: 23, trackingNumber: '1Z999' }),
        ticket({ key: 'PARTS-3', sheetRow: 24, trackingNumber: null }),
      ],
      GroupMode.VENDOR,
    );

    expect(groups[0].trackingNumbers).toEqual(['1Z999']);
    expect(groups[0].sheetRows).toEqual([23, 24, 25]);
  });

  it('counts the rows that need a human look', () => {
    const groups = groupTickets(
      [
        ticket({ key: 'PARTS-1', outcome: 'attention' }),
        ticket({ key: 'PARTS-2', outcome: 'drift' }),
        ticket({ key: 'PARTS-3', outcome: 'in-sync' }),
      ],
      GroupMode.VENDOR,
    );

    expect(groups[0].needsAttention).toBe(2);
  });

  it('handles an empty list', () => {
    expect(groupTickets([], GroupMode.VENDOR)).toEqual([]);
  });
});
