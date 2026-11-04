// Read-only: exercises getOrderHistory against the live sheet and Jira.
import { SheetsClient } from '../../../src/server/clients/sheetsClient.js';
import { JiraClient } from '../../../src/server/clients/jiraClient.js';
import { OrderSheetService } from '../../../src/server/services/orderSheetService.js';
import { ReceivingService } from '../../../src/server/services/receivingService.js';
const orderSheetService = new OrderSheetService({ sheetsClient: new SheetsClient() });
const svc = new ReceivingService({ jiraClient: new JiraClient(), orderSheetService });
const { orders } = await svc.getOrderHistory();
for (const o of orders) {
  const withPerson = o.lines.filter((l) => l.requestedBy).length;
  console.log(o.date, `rows ${o.firstRow}-${o.lastRow}`, `${o.lines.length} lines`, `${withPerson} with requester`, o.vendors.join('/'), '$' + o.total.toFixed(2));
}
console.log('sample:', JSON.stringify(orders[0].lines.slice(-2).map((l) => [l.key, l.vendor, l.requestedBy?.displayName, l.assembly?.name, l.sheetStatus])));
console.log('next writable row:', await orderSheetService.findNextWritableRow());
const r = await svc.getReceiving();
console.log('check-in sheet-only lines that look like dates:', r.tickets.filter((t) => t.sheetOnly && /^\d{5}$/.test(t.summary)).length);
