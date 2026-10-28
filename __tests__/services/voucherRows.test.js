import { OrderSheetService } from '../../src/server/services/orderSheetService.js';

/**
 * The per-vendor voucher block is located by its heading in column A rather
 * than by fixed row numbers, so adding a voucher vendor to the sheet does not
 * need a code change.
 */
function serviceFor(overviewRows) {
  const sheetsClient = {
    async getTab() {
      return { rowCount: overviewRows.length, columnCount: 8, title: 'Overview' };
    },
    async readRange(title, { startRow, endRow, startColumn, endColumn }) {
      const rows = [];
      for (let r = startRow; r < Math.min(endRow, overviewRows.length); r++) {
        rows.push((overviewRows[r] ?? []).slice(startColumn, endColumn));
      }
      return { rows };
    },
  };
  return new OrderSheetService({ sheetsClient });
}

/** Mirrors the real Overview layout: totals block, gap, voucher block. */
function realisticOverview() {
  const rows = Array.from({ length: 40 }, () => ['', '', '', '']);
  rows[0] = ['', 'Budget', 'Spent', 'Remaining'];
  rows[1] = ['Total', 47721, 2769.82, 29951.18];
  rows[2] = ['Voucher', 200, 0, 200];
  rows[3] = ['Tooling', 6000, 294.39, 5705.61];
  rows[4] = ['Robot', 29221, 1385.21, 27835.79];
  rows[5] = ['Game', 5000, 1063.84, 3936.16];
  rows[6] = ['Business', 1500, 26.38, 1473.62];
  rows[28] = ['Voucher Codes (selected from the Voucher Codes tab)', '', '', ''];
  rows[29] = ['Online Metals', 200, 0, 200];
  rows[30] = ['WCP', '', 0, 0];
  rows[31] = ['Thrifty', '', 0, 0];
  rows[32] = ['Rev', '', 0, 0];
  rows[33] = ['Andymark', '', 0, 0];
  rows[34] = ['Fabworks', '', 0, 0];
  rows[35] = ['Westbrook', '', 0, 0];
  return rows;
}

describe('OrderSheetService.readBudget', () => {
  it('reads the total and the five category rows', async () => {
    const budget = await serviceFor(realisticOverview()).readBudget();

    expect(budget.total).toMatchObject({ classification: 'Total', remaining: 29951.18 });
    expect(budget.categories.map((c) => c.classification))
      .toEqual(['Voucher', 'Tooling', 'Robot', 'Game', 'Business']);
  });

  it('reads the voucher block by its heading, not a fixed row', async () => {
    const budget = await serviceFor(realisticOverview()).readBudget();

    expect(budget.vouchers.map((v) => v.vendor)).toEqual([
      'Online Metals', 'WCP', 'Thrifty', 'Rev', 'Andymark', 'Fabworks', 'Westbrook',
    ]);
    expect(budget.vouchers[0]).toMatchObject({ budget: 200, spent: 0, remaining: 200 });
  });

  it('picks up a voucher vendor appended to the block', async () => {
    const rows = realisticOverview();
    rows[36] = ['New Sponsor', 500, 0, 500];

    const budget = await serviceFor(rows).readBudget();

    expect(budget.vouchers.map((v) => v.vendor)).toContain('New Sponsor');
    expect(budget.vouchers).toHaveLength(8);
  });

  it('stops at the first blank row rather than swallowing later content', async () => {
    const rows = realisticOverview();
    rows[37] = ['Something Else Entirely', 1, 2, 3];

    const budget = await serviceFor(rows).readBudget();

    expect(budget.vouchers.map((v) => v.vendor)).not.toContain('Something Else Entirely');
    expect(budget.vouchers).toHaveLength(7);
  });

  it('returns an empty voucher list when the heading is absent', async () => {
    const rows = realisticOverview();
    rows[28] = ['', '', '', ''];
    rows[29] = ['', '', '', ''];

    expect((await serviceFor(rows).readBudget()).vouchers).toEqual([]);
  });
});
