import { jest } from '@jest/globals';
import { VendorCatalog } from '../../src/server/services/vendorCatalog.js';

/** A fake store: url -> body (string JSON) or a status number. */
function fakeHttp(routes) {
  return {
    get: jest.fn(async (url) => {
      const hit = routes[url];
      if (hit === undefined || typeof hit === 'number') {
        const err = new Error(`status ${hit ?? 404}`);
        err.response = { status: hit ?? 404 };
        throw err;
      }
      if (Buffer.isBuffer(hit.body)) return { data: hit.body, headers: { 'content-type': hit.type } };
      return { data: typeof hit === 'string' ? hit : JSON.stringify(hit), headers: {} };
    }),
  };
}

const jiraWith = (issues = []) => ({ searchIssues: jest.fn().mockResolvedValue(issues) });

const order = (key, sku, extra = {}) => ({
  key,
  fields: {
    summary: 'thing', status: { name: 'Delivered' }, customfield_10203: sku, customfield_10206: 3, customfield_10205: 9.99, customfield_10208: 'WCP', customfield_10200: null, ...extra,
  },
});

const product = (handle, variants, extra = {}) => ({
  handle, title: `Title ${handle}`, featured_image: '//cdn.shopify.com/s/files/x.png', available: true, price: 2499, variants, ...extra,
});

describe('VendorCatalog.lookup', () => {
  it('finds the listing named after the SKU and the order tickets with that exact SKU', async () => {
    const http = fakeHttp({ 'https://wcproducts.com/products/wcp-1706.js': product('wcp-1706', [{ sku: 'WCP-1706', price: 2499, available: true }]) });
    const jiraClient = jiraWith([order('PARTS-2', 'WCP-1706'), order('PARTS-1', 'WCP-17060')]);
    const { results } = await new VendorCatalog({ jiraClient, http }).lookup([{ sku: 'wcp-1706' }]);
    expect(results['WCP-1706']).toMatchObject({
      vendor: 'WCP',
      productUrl: 'https://wcproducts.com/products/wcp-1706',
      catalog: { title: 'Title wcp-1706', price: 24.99, available: true, hasImage: true },
    });
    expect(results['WCP-1706'].orders.map((o) => o.key)).toEqual(['PARTS-2']);
    const [jql] = jiraClient.searchIssues.mock.calls[0];
    expect(jql).toBe('project = PARTS AND (cf[10203] ~ "\\"WCP-1706\\"") ORDER BY created DESC');
  });

  it('keeps a search result only when one of its variants is this SKU', async () => {
    const suggest = 'https://wcproducts.com/search/suggest.json?q=WCP-0001&resources%5Btype%5D=product&resources%5Blimit%5D=4';
    const http = fakeHttp({
      [suggest]: { resources: { results: { products: [{ handle: 'bundle' }, { handle: 'tubing' }] } } },
      'https://wcproducts.com/products/bundle.js': product('bundle', [{ sku: 'BND-1' }]),
      'https://wcproducts.com/products/tubing.js': product('tubing', [{ id: 7, sku: 'WCP-0002', title: '1x1', price: 100 }, { id: 8, sku: 'WCP-0001', title: '2x2', price: 3999, available: false }]),
    });
    const { results } = await new VendorCatalog({ jiraClient: jiraWith(), http }).lookup([{ sku: 'WCP-0001' }]);
    expect(results['WCP-0001'].catalog).toEqual({
      title: 'Title tubing — 2x2', price: 39.99, available: false, url: 'https://wcproducts.com/products/tubing?variant=8', hasImage: true,
    });
  });

  it('uses a ticket link on a known store, but claims no price for a product with other variants', async () => {
    const http = fakeHttp({
      'https://wcproducts.com/products/aluminum-tubing.js': product('aluminum-tubing', [{ sku: 'A' }, { sku: 'B', price: 799 }]),
    });
    const jiraClient = jiraWith([order('PARTS-9', 'WCP-1585', { customfield_10200: 'https://wcproducts.com/collections/x/products/aluminum-tubing' })]);
    const { results } = await new VendorCatalog({ jiraClient, http }).lookup([{ sku: 'WCP-1585' }]);
    expect(results['WCP-1585'].catalog).toMatchObject({ title: 'Title aluminum-tubing', price: null, available: null });
  });

  it('never follows a ticket link to another host, and points at the store search when nothing is found', async () => {
    const http = fakeHttp({});
    const jiraClient = jiraWith([order('PARTS-9', 'WCP-0009', { customfield_10200: 'https://evil.example/products/wcp-0009' })]);
    const { results } = await new VendorCatalog({ jiraClient, http }).lookup([{ sku: 'WCP-0009' }]);
    expect(results['WCP-0009'].catalog).toBeNull();
    expect(results['WCP-0009'].productUrl).toBe('https://wcproducts.com/search?q=WCP-0009');
    expect(http.get.mock.calls.every(([url]) => url.startsWith('https://wcproducts.com/'))).toBe(true);
  });

  it('asks no store for a vendor it cannot read, and still answers when the order search fails', async () => {
    const http = fakeHttp({});
    const jiraClient = { searchIssues: jest.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 503 })) };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { results } = await new VendorCatalog({ jiraClient, http }).lookup([{ sku: 'REV-21-1650' }]);
    warn.mockRestore();
    expect(http.get).not.toHaveBeenCalled();
    expect(results['REV-21-1650']).toMatchObject({ vendor: 'Rev', orders: null, catalog: null, productUrl: 'https://www.revrobotics.com/rev-21-1650/' });
  });

  it('drops SKUs that are not plain part numbers', async () => {
    const jiraClient = jiraWith();
    const { results } = await new VendorCatalog({ jiraClient, http: fakeHttp({}) }).lookup([{ sku: 'a" OR 1=1' }, { sku: '' }]);
    expect(results).toEqual({});
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
  });

  it('remembers a listing, so a second page load asks the store nothing', async () => {
    const http = fakeHttp({ 'https://wcproducts.com/products/wcp-1706.js': product('wcp-1706', [{ sku: 'WCP-1706' }]) });
    const catalog = new VendorCatalog({ jiraClient: jiraWith(), http });
    await catalog.lookup([{ sku: 'WCP-1706' }]);
    await catalog.lookup([{ sku: 'WCP-1706' }]);
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});

describe('VendorCatalog.image', () => {
  it('fetches the listing picture from the store CDN, small', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const http = fakeHttp({
      'https://wcproducts.com/products/wcp-1706.js': product('wcp-1706', [{ sku: 'WCP-1706' }]),
      'https://cdn.shopify.com/s/files/x.png?width=300': { body: png, type: 'image/png' },
    });
    const found = await new VendorCatalog({ jiraClient: jiraWith(), http }).image('WCP-1706');
    expect(found).toEqual({ image: png, contentType: 'image/png' });
  });

  it('refuses a picture that is off the store CDN or not an image', async () => {
    const http = fakeHttp({
      'https://wcproducts.com/products/wcp-1.js': product('wcp-1', [{ sku: 'WCP-1' }], { featured_image: 'https://evil.example/x.png' }),
      'https://wcproducts.com/products/wcp-2.js': product('wcp-2', [{ sku: 'WCP-2' }], { featured_image: 'https://cdn.shopify.com/y.svg' }),
      'https://cdn.shopify.com/y.svg?width=300': { body: Buffer.from('<svg/>'), type: 'image/svg+xml' },
    });
    const catalog = new VendorCatalog({ jiraClient: jiraWith(), http });
    expect(await catalog.image('WCP-1')).toBeNull();
    expect(await catalog.image('WCP-2')).toBeNull();
    expect(await catalog.image('../x')).toBeNull();
    expect(http.get.mock.calls.some(([url]) => url.includes('evil.example'))).toBe(false);
  });
});
