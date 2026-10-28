/**
 * Regression tests for the service-layer defects a code review found.
 */

import { jest } from '@jest/globals';
import { OrderSheetService } from '../../src/server/services/orderSheetService.js';
import { ReceivingService } from '../../src/server/services/receivingService.js';
import { PartService } from '../../src/server/services/partService.js';
import { OrderColumn } from '../../src/server/utils/purchasingConstants.js';

const HEADER = [
  'Classification', 'Wish ID', 'Part #', 'Vendor', 'Description', 'Qty', 'Price',
  'Link', 'Jira Key', 'Tracking Number', 'Shipping Cost', 'Receipt Link',
  'Order Status', 'Total', 'Source',
];

function blankRow() {
  const row = new Array(15).fill('');
  row[OrderColumn.TOTAL] = 0;
  return row;
}

function fakeSheetsClient(tabs) {
  return {
    async getTab(title) {
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
      for (const u of updates) {
        tabs[title][u.row] ??= [];
        tabs[title][u.row][u.column] = u.formula !== undefined ? u.formula : u.value;
      }
      return updates.length;
    },
  };
}

const LINE = {
  jiraKey: 'PARTS-1',
  classification: 'Robot',
  wishId: null,
  partNumber: 'WCP-1',
  vendor: 'WCP',
  description: 'A thing',
  qty: 2,
  price: 10,
  link: null,
  source: 'LISD',
};

describe('a concurrent submission cannot overwrite an existing order', () => {
  /**
   * Original defect: rows are filled in place rather than appended, and the
   * target row was resolved before the write with no re-check. Two
   * coordinators submitting at once both resolved the same first blank row, so
   * the second batch silently overwrote the first — the earlier order
   * disappearing from the budget sheet while its tickets had already been
   * moved to Sent to VFF.
   */
  it('refuses when the target row filled up in the meantime', async () => {
    const tabs = { Orders: [HEADER, ...Array.from({ length: 10 }, blankRow)] };
    const sheetsClient = fakeSheetsClient(tabs);
    const service = new OrderSheetService({ sheetsClient });

    // Another submission lands on row 2 after our row was resolved.
    const startRow = await service.findNextWritableRow({ gap: 0 });
    tabs.Orders[startRow - 1][OrderColumn.DESCRIPTION] = 'someone else got here first';

    await expect(service.writeOrderRows({ lines: [LINE], startRow }))
      .rejects.toThrow(/filled up while this submission was being prepared/);
  });

  it('leaves the other order untouched when it refuses', async () => {
    const tabs = { Orders: [HEADER, ...Array.from({ length: 10 }, blankRow)] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    tabs.Orders[1][OrderColumn.DESCRIPTION] = 'existing order';
    await expect(service.writeOrderRows({ lines: [LINE], startRow: 2 })).rejects.toThrow();

    expect(tabs.Orders[1][OrderColumn.DESCRIPTION]).toBe('existing order');
    expect(tabs.Orders[1][OrderColumn.JIRA_KEY]).toBe('');
  });

  it('names every occupied row, not just the first', async () => {
    const tabs = { Orders: [HEADER, ...Array.from({ length: 10 }, blankRow)] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    tabs.Orders[1][OrderColumn.DESCRIPTION] = 'a';
    tabs.Orders[2][OrderColumn.DESCRIPTION] = 'b';

    await expect(service.writeOrderRows({
      lines: [LINE, { ...LINE, jiraKey: 'PARTS-2' }],
      startRow: 2,
    })).rejects.toThrow(/rows 2, 3/);
  });

  it('still writes happily into genuinely blank rows', async () => {
    const tabs = { Orders: [HEADER, ...Array.from({ length: 10 }, blankRow)] };
    const service = new OrderSheetService({ sheetsClient: fakeSheetsClient(tabs) });

    const result = await service.writeOrderRows({ lines: [LINE], startRow: 4 });

    expect(result.startRow).toBe(4);
    expect(tabs.Orders[3][OrderColumn.JIRA_KEY]).toBe('PARTS-1');
  });
});

describe('check-in refuses an unmapped Jira status instead of reporting success', () => {
  /**
   * Original defect: an unknown status produced an empty transition list, so
   * the sheet row was marked Delivered, the ticket was left in flight, and the
   * UI said "checked in". Renaming a workflow status in Jira would have
   * quietly broken every check-in.
   */
  function serviceWithStatus(status) {
    const jiraClient = {
      searchIssues: jest.fn().mockResolvedValue([{
        key: 'PARTS-1',
        fields: {
          summary: 'A part', status: { name: status }, reporter: null,
          created: '2026-01-01T00:00:00.000Z',
        },
      }]),
      transitionIssue: jest.fn().mockResolvedValue(undefined),
      getIssue: jest.fn().mockResolvedValue({ fields: {} }),
    };

    const orderSheetService = {
      readOrders: jest.fn().mockResolvedValue([
        { row: 2, jiraKey: 'PARTS-1', orderStatus: '', description: 'A part' },
      ]),
      markRowsDelivered: jest.fn().mockResolvedValue(1),
    };

    return { service: new ReceivingService({ jiraClient, orderSheetService }), jiraClient, orderSheetService };
  }

  it('throws rather than marking the sheet', async () => {
    const { service, orderSheetService } = serviceWithStatus('Emailed to VFF');

    await expect(service.checkIn({ keys: ['PARTS-1'] }))
      .rejects.toThrow(/not a known step of the ordering workflow/);

    expect(orderSheetService.markRowsDelivered).not.toHaveBeenCalled();
  });

  it('points at the constant that needs updating', async () => {
    const { service } = serviceWithStatus('Emailed to VFF');
    await expect(service.checkIn({ keys: ['PARTS-1'] })).rejects.toThrow(/JIRA_STAGE/);
  });

  it('still works for a mapped status', async () => {
    const { service, jiraClient, orderSheetService } = serviceWithStatus('Ordered');

    const result = await service.checkIn({ keys: ['PARTS-1'] });

    expect(result.received).toHaveLength(1);
    expect(orderSheetService.markRowsDelivered).toHaveBeenCalledWith([2]);
    expect(jiraClient.transitionIssue).toHaveBeenCalledTimes(1);
  });
});

describe('the raw-issue endpoint is scoped to this tool\'s own projects', () => {
  /**
   * Original defect: getStory passed any key straight to Jira, and the route
   * is public, so anyone who could reach the server could read any issue the
   * service-account token could see — including unrelated projects.
   */
  function service() {
    const jiraClient = { getIssue: jest.fn().mockResolvedValue({ key: 'ok' }) };
    return { svc: new PartService({ jiraClient, bomService: {} }), jiraClient };
  }

  const originalProject = process.env.PROJECT_KEY;
  beforeAll(() => { process.env.PROJECT_KEY = 'HAR'; });
  afterAll(() => {
    if (originalProject === undefined) delete process.env.PROJECT_KEY;
    else process.env.PROJECT_KEY = originalProject;
  });

  it.each(['SEC-1', 'HR-42', 'FINANCE-7', 'GEN-1', 'CAD-9'])('refuses %s', async (key) => {
    const { svc, jiraClient } = service();
    await expect(svc.getStory(key)).rejects.toThrow(/outside this tool's projects/);
    expect(jiraClient.getIssue).not.toHaveBeenCalled();
  });

  it.each(['HAR-1984', 'PARTS-1286', 'har-1', 'parts-2'])('allows %s', async (key) => {
    const { svc, jiraClient } = service();
    await expect(svc.getStory(key)).resolves.toBeDefined();
    expect(jiraClient.getIssue).toHaveBeenCalledWith(key);
  });

  it('honours PROJECT_KEY rather than a hardcoded list', async () => {
    const { svc } = service();
    process.env.PROJECT_KEY = 'CAD';
    try {
      await expect(svc.getStory('CAD-1')).resolves.toBeDefined();
      await expect(svc.getStory('HAR-1')).rejects.toThrow();
    } finally {
      process.env.PROJECT_KEY = 'HAR';
    }
  });

  it('refuses nonsense keys', async () => {
    const { svc } = service();
    for (const key of ['', null, undefined, 'no-dash', '../../etc/passwd']) {
      await expect(svc.getStory(key)).rejects.toThrow();
    }
  });
});
