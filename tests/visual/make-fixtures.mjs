/**
 * Builds the API fixtures that tests/visual/shots.mjs serves to the browser.
 *
 * Every fixture is produced by the real server services wired to fake
 * clients that return raw Jira / sheet payloads, so the JSON has exactly the
 * shape the server sends and can't drift from the parse code. No credentials
 * and no network: the fakes never construct a real client.
 *
 * Run with `npm run test:visual:fixtures`. Output: tests/visual/fixtures/*.json,
 * each `{ "status": <http status>, "body": <response json> }`.
 */

// Must run before any service module loads: the services read PROJECT_KEY at
// import time, and a static import would be hoisted above this line.
process.env.PROJECT_KEY = 'HAR';
process.env.JIRA_URL = 'https://jira.valor6800.com';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'fixtures');

const { PurchasingService } = await import('../../src/server/services/purchasingService.js');
const { ReceivingService } = await import('../../src/server/services/receivingService.js');
const { PartField } = await import('../../src/server/utils/purchasingConstants.js');

// ---------------------------------------------------------------------------
// Fake clients
// ---------------------------------------------------------------------------

/** A Jira search fake: answers each JQL with the issues whose matcher hits. */
function fakeJira({ search = [], issues = {} }) {
  return {
    async searchIssues(jql) {
      const hit = search.find(({ match }) => match(jql));
      return hit ? hit.issues : [];
    },
    async getIssue(key) {
      if (issues[key]) return issues[key];
      const err = new Error(`Issue ${key} not found`);
      err.status = 404;
      throw err;
    },
  };
}

const person = (name, displayName) => ({ name, displayName });

function partsIssue(key, {
  summary, status, vendor, partNumber, price, qty, link, epic, reporter, created,
}) {
  return {
    key,
    fields: {
      summary,
      status: { name: status },
      reporter,
      creator: reporter,
      created,
      updated: created,
      priority: { name: 'Medium' },
      [PartField.VENDOR]: vendor,
      [PartField.PART_NUMBER]: partNumber,
      [PartField.PRICE]: price,
      [PartField.QTY]: qty,
      [PartField.LINK]: link,
      [PartField.EPIC_LINK]: epic,
    },
  };
}

const sheetRow = (row, values) => ({
  row,
  classification: 'Robot',
  wishId: null,
  partNumber: null,
  vendor: null,
  description: null,
  qty: null,
  price: null,
  link: null,
  jiraKey: null,
  trackingNumber: null,
  shippingCost: null,
  receiptLink: null,
  orderStatus: null,
  total: null,
  source: null,
  ...values,
});

function fakeOrderSheet({ orders }) {
  return {
    async readOrders() { return orders; },
    async readBudget() {
      return {
        total: { classification: 'Total', budget: 25000, spent: 14210.55, remaining: 10789.45 },
        categories: [
          { classification: 'Robot', budget: 15000, spent: 9876.4, remaining: 5123.6 },
          { classification: 'Tooling', budget: 4000, spent: 2210.15, remaining: 1789.85 },
          { classification: 'Business', budget: 3000, spent: 1124, remaining: 1876 },
          { classification: 'Game', budget: 3000, spent: 1000, remaining: 2000 },
        ],
        vouchers: [
          { vendor: 'REV Robotics', budget: 1000, spent: 400, remaining: 600 },
        ],
      };
    },
    async readWishList() {
      return [
        { wishId: 1, item: 'Spare swerve modules', allocated: 2400, reserved: 0, spent: 800, remaining: 1600, notes: null },
        { wishId: 2, item: 'Pit cart rebuild', allocated: 600, reserved: 0, spent: 0, remaining: 600, notes: 'After build season' },
      ];
    },
    async readOptions() {
      return { classifications: ['Robot', 'Tooling', 'Business', 'VFF', 'Voucher', 'Game'], orderStatuses: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Raw inputs
// ---------------------------------------------------------------------------

const MENTOR = person('mentor1', 'Alex Mentor');
const STUDENT = person('student1', 'Sam Student');
const STUDENT2 = person('student2', 'Riley Student');

const approved = [
  partsIssue('PARTS-401', {
    summary: 'Hex bearing 1/2in', status: 'Approved', vendor: 'WCP', partNumber: 'WCP-0072',
    price: 3.99, qty: 12, link: 'https://wcproducts.com/products/bearings', epic: 'HAR-2030',
    reporter: STUDENT, created: '2026-10-20T15:02:00.000-0500',
  }),
  partsIssue('PARTS-402', {
    summary: '1/2in hex shaft, 36in', status: 'Approved', vendor: 'WCP', partNumber: 'WCP-0201',
    price: 21.99, qty: 2, link: 'https://wcproducts.com/products/hex-shaft', epic: 'HAR-2030',
    reporter: STUDENT, created: '2026-10-21T10:15:00.000-0500',
  }),
  partsIssue('PARTS-403', {
    summary: 'Socket head cap screw 10-32 x 1/2in (100)', status: 'Approved', vendor: 'McMaster Carr',
    partNumber: '92196A269', price: 11.48, qty: 1, link: 'https://www.mcmaster.com/92196A269/',
    epic: 'HAR-1984', reporter: STUDENT2, created: '2026-10-22T09:40:00.000-0500',
  }),
  partsIssue('PARTS-404', {
    summary: 'NEO Vortex brushless motor', status: 'Approved', vendor: 'REV Robotics',
    partNumber: 'REV-21-1652', price: 59.99, qty: 2, link: 'https://www.revrobotics.com/rev-21-1652/',
    epic: 'HAR-2030', reporter: MENTOR, created: '2026-10-23T18:05:00.000-0500',
  }),
];

const history = [
  partsIssue('PARTS-300', {
    summary: 'Hex bearing 1/2in', status: 'Delivered', vendor: 'WCP', partNumber: 'WCP-0072',
    price: 3.99, qty: 8, epic: 'HAR-1979', reporter: STUDENT, created: '2026-09-01T12:00:00.000-0500',
  }),
  partsIssue('PARTS-301', {
    summary: 'NEO Vortex brushless motor', status: 'Delivered', vendor: 'REV Robotics',
    partNumber: 'REV-21-1652', price: 59.99, qty: 4, epic: 'HAR-1979', reporter: MENTOR,
    created: '2026-09-05T12:00:00.000-0500',
  }),
];

const inFlight = [
  partsIssue('PARTS-350', {
    summary: 'Polycarbonate sheet 1/8in 24x48', status: 'Ordered', vendor: 'McMaster Carr',
    partNumber: '8574K26', price: 64.12, qty: 1, epic: 'HAR-2030', reporter: STUDENT,
    created: '2026-10-10T12:00:00.000-0500',
  }),
  partsIssue('PARTS-351', {
    summary: 'Timing belt 9mm HTD 5mm 225T', status: 'Sent to VFF', vendor: 'WCP',
    partNumber: 'WCP-0447', price: 8.99, qty: 3, epic: 'HAR-1984', reporter: STUDENT2,
    created: '2026-10-12T12:00:00.000-0500',
  }),
];

const assemblyIssues = {
  'HAR-2030': { key: 'HAR-2030', fields: { summary: 'VF27A-0000A Test Assembly', customfield_10104: 'VF27A-0000A Test Assembly' } },
  'HAR-1984': { key: 'HAR-1984', fields: { summary: 'VR26A-1200A End Effector', customfield_10104: 'VR26A-1200A End Effector' } },
};

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const fixtures = {};

const purchasing = new PurchasingService({
  jiraClient: fakeJira({
    search: [
      { match: (jql) => /status = "Approved"/.test(jql), issues: approved },
      { match: (jql) => /status != "Approved"/.test(jql), issues: history },
    ],
  }),
  orderSheetService: fakeOrderSheet({ orders: [sheetRow(40, { jiraKey: 'PARTS-300', description: 'Hex bearing 1/2in', orderStatus: 'Delivered' })] }),
});
fixtures['purchasing-queue'] = { status: 200, body: await purchasing.getQueue() };

const receiving = new ReceivingService({
  jiraClient: fakeJira({
    search: [{ match: (jql) => /status IN/.test(jql), issues: inFlight }],
    issues: assemblyIssues,
  }),
  orderSheetService: fakeOrderSheet({
    orders: [
      sheetRow(52, {
        jiraKey: 'PARTS-350', description: 'Polycarbonate sheet 1/8in 24x48', vendor: 'McMaster Carr',
        partNumber: '8574K26', qty: 1, price: 64.12, orderStatus: 'Ordered', trackingNumber: '1Z999AA10123456784',
      }),
      sheetRow(53, {
        jiraKey: 'PARTS-351', description: 'Timing belt 9mm HTD 5mm 225T', vendor: 'WCP',
        partNumber: 'WCP-0447', qty: 3, price: 8.99, orderStatus: 'Ordered',
      }),
      sheetRow(54, {
        description: 'Zip ties, 8in (100)', vendor: 'Amazon', qty: 1, price: 6.49, orderStatus: 'Ordered',
      }),
    ],
  }),
});
fixtures.receiving = { status: 200, body: await receiving.getReceiving() };

// The gate's signed-out answer (src/server/auth/requireAuth.js).
fixtures['auth-401'] = { status: 401, body: { error: 'Not signed in', status: 401, loginUrl: '/auth/login' } };

// ---------------------------------------------------------------------------
// Checks and write
// ---------------------------------------------------------------------------

function assert(cond, message) {
  if (!cond) {
    console.error(`make-fixtures: ${message}`);
    process.exit(1);
  }
}

assert(fixtures['purchasing-queue'].body.vendorGroups.length > 1, 'purchasing queue has fewer than 2 vendor groups');
assert(fixtures.receiving.body.tickets.length > 0, 'receiving has no tickets');
const assemblyKey = fixtures.receiving.body.tickets.find((t) => t.assembly)?.assembly.key;
assert(assemblyKey?.startsWith('HAR-'), `generated Assembly key "${assemblyKey}" does not start with HAR-`);

await fs.mkdir(OUT_DIR, { recursive: true });
for (const [name, fixture] of Object.entries(fixtures)) {
  await fs.writeFile(path.join(OUT_DIR, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
}
console.log(`make-fixtures: wrote ${Object.keys(fixtures).length} fixtures to ${path.relative(process.cwd(), OUT_DIR)}`);
