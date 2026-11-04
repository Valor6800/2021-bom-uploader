import { OrderSheetService } from '../../src/server/services/orderSheetService.js';
import { OrderColumn, OrderStatus } from '../../src/server/utils/purchasingConstants.js';

/**
 * Builds a fake SheetsClient backed by a plain 2D array per tab, so the row
 * scanning and fill-in-place logic can be exercised without touching Google.
 */
function fakeSheetsClient(tabs) {
  const writes = [];

  return {
    writes,
    async getTab(title) {
      if (!tabs[title]) throw new Error(`no tab ${title}`);
      return { rowCount: tabs[title].length, columnCount: 20, title };
    },
    async readRange(title, { startRow, endRow, startColumn, endColumn }) {
      const grid = tabs[title];
      const rows = [];
      for (let r = startRow; r < Math.min(endRow, grid.length); r++) {
        rows.push((grid[r] ?? []).slice(startColumn, endColumn));
      }
      return { rows };
    },
    async writeCells(title, updates) {
      writes.push({ title, updates });
      for (const u of updates) {
        tabs[title][u.row] ??= [];
        if (u.formula !== undefined) tabs[title][u.row][u.column] = u.formula;
        else if (u.value !== undefined) tabs[title][u.row][u.column] = u.value;
      }
      return updates.length;
    },
  };
}

/** A blank Orders row carrying only the pre-filled Total formula result. */
function blankRow() {
  const row = new Array(15).fill('');
  row[OrderColumn.TOTAL] = 0;
  return row;
}

/** A black order-date row: the date serial in Description, nothing else. */
function dateRow(serial) {
  const row = blankRow();
  row[OrderColumn.DESCRIPTION] = serial;
  return row;
}

function orderRow({ description, jiraKey = '', classification = 'Robot' }) {
  const row = blankRow();
  row[OrderColumn.CLASSIFICATION] = classification;
  row[OrderColumn.DESCRIPTION] = description;
  row[OrderColumn.JIRA_KEY] = jiraKey;
  return row;
}

const HEADER = [
  'Classification', 'Wish ID', 'Part #', 'Vendor', 'Description', 'Qty', 'Price',
  'Link', 'Jira Key', 'Tracking Number', 'Shipping Cost', 'Receipt Link',
  'Order Status', 'Total', 'Source',
];

describe('OrderSheetService.findNextWritableRow', () => {
  it('leaves one spacer row after the last populated row', async () => {
    // Rows 2 and 3 populated (indices 1, 2) -> next writable is row 5.
    const tabs = {
      Orders: [HEADER, orderRow({ description: 'a' }), orderRow({ description: 'b' }),
        blankRow(), blankRow(), blankRow()],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.findNextWritableRow()).toBe(5);
  });

  it('honours a zero gap', async () => {
    const tabs = { Orders: [HEADER, orderRow({ description: 'a' }), blankRow()] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.findNextWritableRow({ gap: 0 })).toBe(3);
  });

  it('starts directly under the header when the log is empty', async () => {
    const tabs = { Orders: [HEADER, blankRow(), blankRow()] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.findNextWritableRow()).toBe(2);
  });

  it('skips past interior spacer rows rather than filling them', async () => {
    // Mirrors the real sheet: data, spacer, data, spacer, data.
    const tabs = {
      Orders: [
        HEADER,
        orderRow({ description: 'a' }),
        blankRow(),
        orderRow({ description: 'b' }),
        blankRow(),
        orderRow({ description: 'c' }),
        blankRow(), blankRow(),
      ],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    // Last populated row is 6 -> next writable is 8.
    expect(await service.findNextWritableRow()).toBe(8);
  });

  it('does not treat a pre-filled Total formula as a populated row', async () => {
    const tabs = { Orders: [HEADER, blankRow(), blankRow(), blankRow()] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.findNextWritableRow()).toBe(2);
  });
});

describe('OrderSheetService.writeOrderRows', () => {
  const line = {
    jiraKey: 'PARTS-1',
    classification: 'Robot',
    source: 'LISD',
    wishId: null,
    partNumber: 'WCP-1',
    vendor: 'WCP',
    description: 'A thing',
    qty: 2,
    price: 10,
    link: 'https://example.com',
  };

  function freshTabs() {
    return { Orders: [HEADER, ...Array.from({ length: 20 }, blankRow)] };
  }

  it('fills consecutive rows in place and reports the assignments', async () => {
    const tabs = freshTabs();
    const client = fakeSheetsClient(tabs);
    const service = new OrderSheetService({ sheetsClient: client });

    const result = await service.writeOrderRows({
      lines: [line, { ...line, jiraKey: 'PARTS-2' }],
    });

    expect(result.startRow).toBe(2);
    expect(result.endRow).toBe(3);
    expect(result.assignments).toEqual([
      { jiraKey: 'PARTS-1', row: 2 },
      { jiraKey: 'PARTS-2', row: 3 },
    ]);
  });

  it('writes the expected cell values', async () => {
    const tabs = freshTabs();
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    await service.writeOrderRows({ lines: [{ ...line, source: 'VFF' }] });

    const written = tabs.Orders[1];
    expect(written[OrderColumn.CLASSIFICATION]).toBe('Robot');
    expect(written[OrderColumn.PART_NUMBER]).toBe('WCP-1');
    expect(written[OrderColumn.VENDOR]).toBe('WCP');
    expect(written[OrderColumn.DESCRIPTION]).toBe('A thing');
    expect(written[OrderColumn.QTY]).toBe(2);
    expect(written[OrderColumn.PRICE]).toBe(10);
    expect(written[OrderColumn.JIRA_KEY]).toBe('PARTS-1');
    expect(written[OrderColumn.SOURCE]).toBe('VFF');
  });

  it('leaves Order Status blank, since the sheet has no Submitted value', async () => {
    const tabs = freshTabs();
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    await service.writeOrderRows({ lines: [line] });

    expect(tabs.Orders[1][OrderColumn.ORDER_STATUS]).toBe('');
  });

  it('does not touch the Total column inside the pre-formulated block', async () => {
    const tabs = freshTabs();
    const client = fakeSheetsClient(tabs);
    const service = new OrderSheetService({ sheetsClient: client });

    await service.writeOrderRows({ lines: [line] });

    const totalWrites = client.writes
      .flatMap((w) => w.updates)
      .filter((u) => u.column === OrderColumn.TOTAL)
      .filter((u) => u.value !== undefined || u.formula !== undefined);

    expect(totalWrites).toHaveLength(0);
  });

  it('writes the Total formula itself past the pre-formulated block', async () => {
    const tabs = { Orders: [HEADER, ...Array.from({ length: 600 }, blankRow)] };
    const client = fakeSheetsClient(tabs);
    const service = new OrderSheetService({ sheetsClient: client });

    await service.writeOrderRows({ lines: [line], startRow: 500 });

    const formulaWrite = client.writes
      .flatMap((w) => w.updates)
      .find((u) => u.column === OrderColumn.TOTAL);

    expect(formulaWrite.formula).toBe('=(F500*G500)+K500');
  });

  it('writes Wish ID 0 rather than dropping it as falsy', async () => {
    const tabs = freshTabs();
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    await service.writeOrderRows({ lines: [{ ...line, wishId: 0 }] });

    expect(tabs.Orders[1][OrderColumn.WISH_ID]).toBe(0);
  });

  it('writes each line its own Source, since vendors can draw on different funds', async () => {
    const tabs = freshTabs();
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    await service.writeOrderRows({
      lines: [
        { ...line, jiraKey: 'PARTS-1', source: 'LISD' },
        { ...line, jiraKey: 'PARTS-2', source: 'VFF' },
        { ...line, jiraKey: 'PARTS-3', source: '' },
      ],
    });

    expect(tabs.Orders[1][OrderColumn.SOURCE]).toBe('LISD');
    expect(tabs.Orders[2][OrderColumn.SOURCE]).toBe('VFF');
    expect(tabs.Orders[3][OrderColumn.SOURCE]).toBe('');
  });

  it('writes a blank Source when none is given', async () => {
    const tabs = freshTabs();
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });
    const { source, ...withoutSource } = line;

    await service.writeOrderRows({ lines: [withoutSource] });

    expect(tabs.Orders[1][OrderColumn.SOURCE]).toBe('');
  });

  it('rejects a batch that would run past the end of the tab', async () => {
    const tabs = { Orders: [HEADER, blankRow()] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    await expect(
      service.writeOrderRows({ lines: [line, { ...line, jiraKey: 'PARTS-2' }] }),
    ).rejects.toThrow(/only has 2 rows/);
  });

  it('rejects an empty batch', async () => {
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(freshTabs()) });

    await expect(service.writeOrderRows({ lines: [] }))
      .rejects.toThrow(/non-empty/);
  });
});

describe('OrderSheetService.buildJiraKeyIndex', () => {
  it('maps keys to row numbers, case-insensitively', async () => {
    const tabs = {
      Orders: [
        HEADER,
        orderRow({ description: 'a', jiraKey: 'PARTS-10' }),
        orderRow({ description: 'b' }),
        orderRow({ description: 'c', jiraKey: 'parts-12' }),
      ],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    const index = await service.buildJiraKeyIndex();

    expect(index.get('PARTS-10')).toBe(2);
    expect(index.get('PARTS-12')).toBe(4);
    expect(index.size).toBe(2);
  });
});

describe('OrderSheetService.markRowsDelivered', () => {
  it('sets Order Status on each given row', async () => {
    const tabs = {
      Orders: [HEADER, orderRow({ description: 'a' }), orderRow({ description: 'b' })],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.markRowsDelivered([2, 3])).toBe(2);
    expect(tabs.Orders[1][OrderColumn.ORDER_STATUS]).toBe(OrderStatus.DELIVERED);
    expect(tabs.Orders[2][OrderColumn.ORDER_STATUS]).toBe(OrderStatus.DELIVERED);
  });

  it('is a no-op for an empty list', async () => {
    const client = fakeSheetsClient({ Orders: [HEADER] });
    const service = new OrderSheetService({ sheetsClient: client });

    expect(await service.markRowsDelivered([])).toBe(0);
    expect(client.writes).toHaveLength(0);
  });
});

describe('OrderSheetService.readWishList', () => {
  it('keeps bucket 0 and drops empty numbered placeholders', async () => {
    const tabs = {
      'Wish-List': [
        ['Wish ID', 'Item', 'Allocated', 'Reserved', 'Spent', 'Remaining', '', '', 'Notes'],
        [0, 'Hardware', 2500, '', 0, 2500, '', '', 'NEED'],
        [1, 'COTS', 5000, '', 0, 5000, '', '', 'NEED'],
        [30, '', '', '', 0, 0, '', '', ''],
        ['', '', '', '', 0, 0, '', '', ''],
      ],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    const buckets = await service.readWishList();

    expect(buckets.map((b) => b.wishId)).toEqual([0, 1]);
    expect(buckets[0]).toMatchObject({ item: 'Hardware', allocated: 2500, notes: 'NEED' });
  });
});

describe('order-date rows', () => {
  // 46324 = 2026-10-29, 46310 = 2026-10-15
  const line = {
    jiraKey: 'PARTS-1', classification: 'Robot', source: 'LISD', wishId: null,
    partNumber: 'WCP-1', vendor: 'WCP', description: 'A thing', qty: 2, price: 10,
    link: null,
  };

  it('are not returned as order lines', async () => {
    const tabs = {
      Orders: [HEADER, orderRow({ description: 'a' }), dateRow(46310), orderRow({ description: 'b' })],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect((await service.readOrders()).map((o) => o.description)).toEqual(['a', 'b']);
  });

  it('a date row with a stray 0 in Source is still a date row', async () => {
    const row = dateRow(46310);
    row[OrderColumn.SOURCE] = 0;
    const tabs = { Orders: [HEADER, orderRow({ description: 'a' }), row] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.readOrders()).toHaveLength(1);
  });

  it('a numeric Description on a real part line is not mistaken for a date', async () => {
    const row = orderRow({ description: 46310 });
    const tabs = { Orders: [HEADER, row] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.readOrders()).toHaveLength(1);
  });

  it('divide history into orders, newest first, each dated by the row below it', async () => {
    const tabs = {
      Orders: [
        HEADER,
        orderRow({ description: 'a' }),
        orderRow({ description: 'b' }),
        dateRow(46310),
        orderRow({ description: 'c' }),
        dateRow('10/29/2026'),
        orderRow({ description: 'd' }),
        blankRow(),
      ],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    const history = await service.readOrderHistory();

    expect(history.map((o) => [o.date, o.dateRow, o.lines.map((l) => l.description)])).toEqual([
      [null, null, ['d']],
      ['2026-10-29', 6, ['c']],
      ['2026-10-15', 4, ['a', 'b']],
    ]);
  });

  it('a new order starts directly under a date row, with no spacer', async () => {
    const tabs = {
      Orders: [HEADER, orderRow({ description: 'a' }), dateRow(46324), blankRow(), blankRow()],
    };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    expect(await service.findNextWritableRow()).toBe(4);
  });

  it('are written black after the last line, dated in Description', async () => {
    const tabs = { Orders: [HEADER, ...Array.from({ length: 10 }, blankRow)] };
    const client = fakeSheetsClient(tabs);
    const service = new OrderSheetService({ sheetsClient: client });

    const result = await service.writeOrderRows({
      lines: [line, { ...line, jiraKey: 'PARTS-2' }],
      orderDate: '2026-10-29',
    });

    expect(result).toMatchObject({ startRow: 2, endRow: 3, dateRow: 4, orderDate: '2026-10-29' });

    const dateUpdates = client.writes.flatMap((w) => w.updates).filter((u) => u.row === 3);
    expect(dateUpdates).toHaveLength(15);
    for (const u of dateUpdates) {
      expect(u.format.backgroundColor).toEqual({ red: 0, green: 0, blue: 0 });
    }

    const dateCell = dateUpdates.find((u) => u.column === OrderColumn.DESCRIPTION);
    expect(dateCell.value).toBe(46324);
    expect(dateCell.format.numberFormat).toEqual({ type: 'DATE', pattern: 'm/d/yyyy' });
    expect(dateUpdates.filter((u) => u.value !== undefined)).toHaveLength(1);

    // And the next order reads back as one dated order.
    const history = await service.readOrderHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ date: '2026-10-29', firstRow: 2, lastRow: 3 });
    expect(await service.findNextWritableRow()).toBe(5);
  });

  it('defaults the date to today in the spreadsheet time zone', async () => {
    const tabs = { Orders: [HEADER, ...Array.from({ length: 5 }, blankRow)] };
    const client = { ...fakeSheetsClient(tabs), timeZone: async () => 'America/Chicago' };
    const service = new OrderSheetService({ sheetsClient: client });

    const { orderDate } = await service.writeOrderRows({ lines: [line] });

    expect(orderDate).toBe(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()),
    );
  });

  it('refuses when the tab has room for the lines but not the date row', async () => {
    const tabs = { Orders: [HEADER, blankRow()] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    await expect(service.writeOrderRows({ lines: [line] })).rejects.toThrow(/order-date row/);
  });
});
