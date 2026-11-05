/**
 * The saved order alongside the queue and submit flows: it comes back with the
 * queue, and tickets leave it once they leave the queue or are submitted.
 */
import { jest } from '@jest/globals';
import { PurchasingService } from '../../src/server/services/purchasingService.js';
import { PartField } from '../../src/server/utils/purchasingConstants.js';

const issue = (key) => ({
  key,
  fields: {
    summary: `Part ${key}`,
    status: { name: 'Approved' },
    [PartField.VENDOR]: 'Rev',
    [PartField.PART_NUMBER]: `PN-${key}`,
    [PartField.PRICE]: 10,
    [PartField.QTY]: 2,
    [PartField.LINK]: 'https://example.com/part',
  },
});

function makeService({ issues = [issue('PARTS-1')], transition = async () => {} } = {}) {
  const orderDraft = {
    read: jest.fn(async () => ({ 'PARTS-1': { selected: true } })),
    update: jest.fn(async () => {}),
    retain: jest.fn(async () => ({ 'PARTS-1': { selected: true } })),
    remove: jest.fn(async () => ({})),
  };

  const service = new PurchasingService({
    jiraClient: {
      searchIssues: jest.fn(async (jql) => (/status = "Approved"/.test(jql) ? issues : [])),
      transitionIssue: jest.fn(transition),
    },
    orderSheetService: {
      readBudget: async () => ({ categories: [], vouchers: [], total: null }),
      readWishList: async () => [],
      readOptions: async () => ({ classifications: ['Robot'], orderStatuses: [] }),
      readOrders: async () => [],
      buildJiraKeyIndex: async () => new Map(),
      writeOrderRows: jest.fn(async ({ lines }) => ({
        startRow: 10,
        endRow: 10 + lines.length - 1,
        dateRow: 10 + lines.length,
        orderDate: '2026-11-05',
        assignments: lines.map((line, i) => ({ jiraKey: line.jiraKey, row: 10 + i })),
      })),
    },
    orderDraft,
  });

  return { service, orderDraft };
}

describe('PurchasingService draft', () => {
  it('returns the saved order with the queue, keeping only tickets still in it', async () => {
    const { service, orderDraft } = makeService({ issues: [issue('PARTS-1'), issue('PARTS-2')] });

    const queue = await service.getQueue();

    expect(orderDraft.retain).toHaveBeenCalledWith(['PARTS-1', 'PARTS-2']);
    expect(queue.draft).toEqual({ 'PARTS-1': { selected: true } });
  });

  it('forgets submitted tickets', async () => {
    const { service, orderDraft } = makeService();

    await service.submit({ rows: [{ key: 'PARTS-1', classification: 'Robot', wishId: null, source: '' }] });

    expect(orderDraft.remove).toHaveBeenCalledWith(['PARTS-1']);
  });

  it('forgets a ticket whose transition failed, since it is on the sheet regardless', async () => {
    const { service, orderDraft } = makeService({
      transition: async () => { throw new Error('nope'); },
    });

    const result = await service.submit({
      rows: [{ key: 'PARTS-1', classification: 'Robot', wishId: null, source: '' }],
    });

    expect(result.errors).toHaveLength(1);
    expect(orderDraft.remove).toHaveBeenCalledWith(['PARTS-1']);
  });

  it('keeps the draft when the sheet write fails, so the order can be retried', async () => {
    const { service, orderDraft } = makeService();
    service.orderSheetService.writeOrderRows.mockRejectedValue(new Error('sheet down'));

    await expect(service.submit({
      rows: [{ key: 'PARTS-1', classification: 'Robot', wishId: null, source: '' }],
    })).rejects.toThrow('sheet down');

    expect(orderDraft.remove).not.toHaveBeenCalled();
  });
});
