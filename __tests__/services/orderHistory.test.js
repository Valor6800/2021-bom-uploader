import { jest } from '@jest/globals';
import { ReceivingService } from '../../src/server/services/receivingService.js';
import { PartField } from '../../src/server/utils/purchasingConstants.js';

function issue(key, { reporter, epic, status = 'Delivered' } = {}) {
  return {
    key,
    fields: {
      summary: `Jira ${key}`,
      status: { name: status },
      reporter: reporter ? { name: reporter.toLowerCase(), displayName: reporter } : null,
      [PartField.EPIC_LINK]: epic ?? null,
    },
  };
}

function setup({ orders, issues }) {
  const jiraClient = {
    searchIssues: jest.fn().mockResolvedValue(issues),
    getIssue: jest.fn().mockImplementation(async (key) => ({ fields: { customfield_10104: `Epic ${key}` } })),
  };
  const orderSheetService = { readOrderHistory: jest.fn().mockResolvedValue(orders) };
  return { service: new ReceivingService({ jiraClient, orderSheetService }), jiraClient };
}

const sheetLine = (row, overrides = {}) => ({
  row, jiraKey: null, vendor: 'WCP', description: `Sheet ${row}`, qty: 2, price: 5,
  total: 12, orderStatus: 'Delivered', classification: 'Robot', ...overrides,
});

describe('ReceivingService.getOrderHistory', () => {
  it('shows who each delivered part went to and which vendor it came from', async () => {
    const { service, jiraClient } = setup({
      orders: [{
        date: '2026-10-29', dateRow: 5, firstRow: 2, lastRow: 4,
        lines: [
          sheetLine(2, { jiraKey: 'PARTS-1' }),
          sheetLine(3, { jiraKey: 'parts-2', vendor: 'Andymark' }),
          sheetLine(4),
        ],
      }],
      issues: [
        issue('PARTS-1', { reporter: 'Ada', epic: 'HAR-10' }),
        issue('PARTS-2', { reporter: 'Grace' }),
        issue('PARTS-99', { reporter: 'Nobody on this sheet' }),
      ],
    });

    const { orders } = await service.getOrderHistory();

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ date: '2026-10-29', total: 36 });
    expect(orders[0].vendors).toEqual(expect.arrayContaining(['WCP']));
    expect(orders[0].lines.map((l) => l.requestedBy?.displayName ?? null)).toEqual(['Ada', 'Grace', null]);
    expect(orders[0].lines[0].assembly).toEqual({ key: 'HAR-10', name: 'Epic HAR-10' });
    expect(orders[0].lines[2].ticketFound).toBe(false);

    // Searches from before the earliest order rather than by key list.
    expect(jiraClient.searchIssues.mock.calls[0][0]).toMatch(/updated >= "2026-08-30"/);
  });

  it('keeps sheet facts for a ticket Jira no longer has', async () => {
    const { service } = setup({
      orders: [{ date: null, dateRow: null, firstRow: 2, lastRow: 2, lines: [sheetLine(2, { jiraKey: 'PARTS-404' })] }],
      issues: [],
    });

    const { orders } = await service.getOrderHistory();

    expect(orders[0].lines[0]).toMatchObject({
      key: 'PARTS-404', summary: 'Sheet 2', ticketFound: false, requestedBy: null,
    });
  });

  it('does not query Jira when no line carries a key', async () => {
    const { service, jiraClient } = setup({
      orders: [{ date: '2026-10-29', dateRow: 3, firstRow: 2, lastRow: 2, lines: [sheetLine(2)] }],
      issues: [],
    });

    await service.getOrderHistory();
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
  });
});
