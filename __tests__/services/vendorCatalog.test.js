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

/** A store's SKU search address, as the catalog builds it. */
const search = (host, sku) => `https://${host}/search/suggest.json?${new URLSearchParams({
  q: sku, 'resources[type]': 'product', 'resources[limit]': '4', 'resources[options][fields]': 'variants.sku',
})}`;
const found = (...products) => ({ resources: { results: { products } } });
const hit = (handle, extra = {}) => ({
  handle, title: `Title ${handle}`, price: '24.99', price_min: '24.99', price_max: '24.99', available: true,
  image: 'https://cdn.shopify.com/s/files/x.png?v=1', ...extra,
});

describe('VendorCatalog.lookup', () => {
  it('finds the listing by SKU search and the order tickets with that exact SKU', async () => {
    const http = fakeHttp({ [search('wcproducts.com', 'WCP-1706')]: found(hit('wcp-1706')) });
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

  it('prefers the product named after the SKU, and claims no price when its variants differ', async () => {
    const http = fakeHttp({
      [search('andymark.com', 'AM-3945')]: found(
        hit('compliant-wheels', { price_min: '6.20', price_max: '9.10' }),
        hit('am-3945', { title: 'Exact', price: '7.00', price_min: '7.00', price_max: '7.00' }),
      ),
      [search('store.ctr-electronics.com', '24-676873')]: found(hit('candi', { price_min: '73.49', price_max: '80.00', available: false })),
    });
    const { results } = await new VendorCatalog({ jiraClient: jiraWith(), http }).lookup([{ sku: 'AM-3945' }, { sku: '24-676873' }]);
    expect(results['AM-3945']).toMatchObject({ vendor: 'Andymark', catalog: { title: 'Exact', price: 7, url: 'https://andymark.com/products/am-3945' } });
    expect(results['24-676873']).toMatchObject({ vendor: 'CTR Electronics', catalog: { title: 'Title candi', price: null, available: false } });
  });

  it('reads REV from its product page, only when the page names this SKU', async () => {
    const page = (sku) => `<meta property="og:title" content="Surgical Tubing &amp; More" />
      <meta property="og:image" content="https://cdn11.bigcommerce.com/s-x/products/227/a.png?c=2" />
      <meta property="product:price:amount" content="7.75" />
      <script type="application/ld+json">{"sku": "${sku}", "offers": {"availability" : "https://schema.org/InStock"}}</script>`;
    const http = fakeHttp({
      'https://www.revrobotics.com/rev-41-1163/': page('REV-41-1163'),
      'https://www.revrobotics.com/rev-11-1956/': page('REV-11-9999'),
    });
    const { results } = await new VendorCatalog({ jiraClient: jiraWith(), http }).lookup([{ sku: 'REV-41-1163' }, { sku: 'REV-11-1956' }]);
    expect(results['REV-41-1163'].catalog).toEqual({
      title: 'Surgical Tubing & More', price: 7.75, available: true, url: 'https://www.revrobotics.com/rev-41-1163/', hasImage: true,
    });
    expect(results['REV-11-1956'].catalog).toBeNull();
    expect(results['REV-11-1956'].productUrl).toBe('https://www.revrobotics.com/rev-11-1956/');
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

  it('leaves a store alone after a 429, without remembering the SKU as missing', async () => {
    const url = search('wcproducts.com', 'WCP-0001');
    const http = fakeHttp({ [url]: 429 });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const catalog = new VendorCatalog({ jiraClient: jiraWith(), http });
    expect((await catalog.lookup([{ sku: 'WCP-0001' }])).results['WCP-0001'].catalog).toBeNull();
    expect((await catalog.lookup([{ sku: 'WCP-0001' }, { sku: 'WCP-0002' }])).results['WCP-0002'].catalog).toBeNull();
    expect(http.get).toHaveBeenCalledTimes(1);
    // Once the wait is over, the same SKU is asked again.
    catalog._backoff.clear();
    http.get.mockClear();
    await catalog.lookup([{ sku: 'WCP-0001' }]);
    expect(http.get).toHaveBeenCalledWith(url, expect.anything());
    warn.mockRestore();
  });

  it('asks no store for a vendor it cannot read, and still answers when the order search fails', async () => {
    const http = fakeHttp({});
    const jiraClient = { searchIssues: jest.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 503 })) };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { results } = await new VendorCatalog({ jiraClient, http }).lookup([{ sku: '217-2737' }, { sku: '91251A540' }]);
    warn.mockRestore();
    expect(http.get).not.toHaveBeenCalled();
    expect(results['217-2737']).toMatchObject({ vendor: 'VEX', orders: null, catalog: null, productUrl: 'https://www.vexrobotics.com/217-2737.html' });
    expect(results['91251A540']).toMatchObject({ vendor: 'McMaster-Carr', productUrl: 'https://www.mcmaster.com/91251A540/' });
  });

  it('offers the tool\'s drawing when an order describes hardware and the vendor has no picture', async () => {
    const jiraClient = jiraWith([order('PARTS-5', '91251A354', { summary: 'Black-Oxide Alloy Steel Socket Head Screw 10-32 Thread Size, 2-1/4" Long' })]);
    const { results } = await new VendorCatalog({ jiraClient, http: fakeHttp({}) }).lookup([{ sku: '91251A354' }]);
    expect(results['91251A354'].drawing).toMatchObject({ kind: 'socket', finish: 'black', length: '2.25' });
  });

  it('drops SKUs that are not plain part numbers', async () => {
    const jiraClient = jiraWith();
    const { results } = await new VendorCatalog({ jiraClient, http: fakeHttp({}) }).lookup([{ sku: 'a" OR 1=1' }, { sku: '' }]);
    expect(results).toEqual({});
    expect(jiraClient.searchIssues).not.toHaveBeenCalled();
  });

  it('remembers a listing, so a second page load asks the store nothing', async () => {
    const http = fakeHttp({ [search('wcproducts.com', 'WCP-1706')]: found(hit('wcp-1706')) });
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
      [search('wcproducts.com', 'WCP-1706')]: found(hit('wcp-1706')),
      'https://cdn.shopify.com/s/files/x.png?v=1&width=300': { body: png, type: 'image/png' },
    });
    const found2 = await new VendorCatalog({ jiraClient: jiraWith(), http }).image('WCP-1706');
    expect(found2).toEqual({ image: png, contentType: 'image/png' });
  });

  it('refuses a picture that is off the store CDN or not an image', async () => {
    const http = fakeHttp({
      [search('wcproducts.com', 'WCP-1')]: found(hit('wcp-1', { image: 'https://evil.example/x.png' })),
      [search('wcproducts.com', 'WCP-2')]: found(hit('wcp-2', { image: 'https://cdn.shopify.com/y.svg' })),
      'https://cdn.shopify.com/y.svg?width=300': { body: Buffer.from('<svg/>'), type: 'image/svg+xml' },
    });
    const catalog = new VendorCatalog({ jiraClient: jiraWith(), http });
    expect(await catalog.image('WCP-1')).toBeNull();
    expect(await catalog.image('WCP-2')).toBeNull();
    expect(await catalog.image('../x')).toBeNull();
    expect(http.get.mock.calls.some(([url]) => url.includes('evil.example'))).toBe(false);
  });
});
