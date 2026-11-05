/**
 * Vendor catalog — what the team knows about an off-the-shelf part, by SKU.
 *
 * - **Orders**: the PARTS order tickets whose vendor Part Number is that SKU
 *   (status, quantity, price, the link the requester gave).
 * - **Catalog**: the vendor's own product listing (title, picture, price,
 *   in stock). Shopify stores (WCP, Thrifty, AndyMark, CTRE) are asked
 *   through their storefront search, limited to the SKU field, which they
 *   answer even when they refuse the product JSON; REV through its product
 *   page (the address is the SKU), kept only when the page names that SKU.
 *   Only the stores below are ever asked, only by SKUs that pass
 *   `SKU_PATTERN`, and only pictures on those stores' CDNs are fetched, so
 *   nothing a user types decides where the server connects.
 *
 * Every answer is kept a while (a day when found, an hour when not) so a page
 * load costs the vendor nothing after the first. A store that says "too many
 * requests" (429) is left alone until it says it may be asked again.
 */

import axios from 'axios';
import { PARTS_PROJECT_KEY, PartField } from '../utils/purchasingConstants.js';
import { SKU_PATTERN, productPageOf, skuOf } from '../utils/vendorSku.js';
import { isUnusableVendor, normalizeVendor } from '../utils/vendorNormalize.js';
import { hardwareOf, hardwareQuery } from '../utils/hardwareSpec.js';

/** A vendor name, normalized; null when blank or unusable. */
const vendorOf = (raw) => (isUnusableVendor(raw) ? null : normalizeVendor(raw));

/** vendor (normalized) -> its Shopify store host. */
const SHOPIFY_STORES = Object.freeze({
  WCP: 'wcproducts.com',
  Thrifty: 'www.thethriftybot.com',
  Andymark: 'andymark.com',
  'CTR Electronics': 'store.ctr-electronics.com',
});
const REV_HOST = 'www.revrobotics.com';
/** Hosts a PARTS ticket's link may point at for its catalog entry. */
const STORE_HOSTS = new Set([
  'wcproducts.com', 'www.wcproducts.com', 'www.thethriftybot.com', 'thethriftybot.com',
  'andymark.com', 'www.andymark.com', 'store.ctr-electronics.com',
]);
const SHOPIFY_CDN = 'cdn.shopify.com';
const IMAGE_HOSTS = new Set([SHOPIFY_CDN, 'cdn11.bigcommerce.com', ...STORE_HOSTS]);

const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;
/** How long a store that answered 429 without saying when is left alone. */
const BACKOFF_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 6000;
const MAX_JSON_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_IMAGES = 300;
const MAX_SKUS = 60;
const CONCURRENCY = 4;
const USER_AGENT = 'ValorBOM (FRC team 6800 parts lookup)';

/** Run `fn` over `items`, `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** An https URL on one of `hosts`, or null. Protocol-relative URLs ("//cdn…") are read as https. */
function safeUrl(raw, hosts) {
  try {
    const url = new URL(String(raw ?? '').startsWith('//') ? `https:${raw}` : String(raw ?? ''));
    return url.protocol === 'https:' && hosts.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Shopify prices: "8.99" in search answers, 899 (cents) in product JSON. */
const dollars = (v, { cents = false } = {}) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return null;
  return cents ? n / 100 : n;
};

/** The content of `<meta property="…" content="…">`, HTML entities for quotes and ampersands undone. */
function metaOf(html, property) {
  const re = new RegExp(`<meta[^>]+property=["']${property.replace(/[.:]/g, '\\$&')}["'][^>]+content=["']([^"']*)["']`, 'i');
  const raw = re.exec(html)?.[1];
  return raw == null ? null : raw.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim();
}

/** The hardware drawing query from the first order summary that describes hardware, or null. */
function drawingFrom(orders) {
  for (const o of orders) {
    const spec = hardwareOf({ name: o.summary });
    if (spec) return hardwareQuery(spec);
  }
  return null;
}

export class VendorCatalog {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {{ get: Function }} [deps.http]  axios-like, for tests
   */
  constructor({ jiraClient, http = axios }) {
    this.jiraClient = jiraClient;
    this.http = http;
    /** sku -> { at, ttl, promise of catalog|null } */
    this._catalog = new Map();
    /** sku -> { at, promise of Buffer|null } */
    this._images = new Map();
    /** host -> when it may be asked again, after a 429 */
    this._backoff = new Map();
  }

  /**
   * @param {{ sku: string, vendor?: string|null }[]} wanted
   * @returns {Promise<{ results: Record<string, object> }>}
   */
  async lookup(wanted) {
    const unique = new Map();
    for (const w of wanted.slice(0, MAX_SKUS)) {
      const sku = String(w?.sku ?? '').trim().toUpperCase();
      if (SKU_PATTERN.test(sku) && !unique.has(sku)) unique.set(sku, vendorOf(w.vendor) ?? skuOf({ partNumber: sku })?.vendor ?? null);
    }
    if (unique.size === 0) return { results: {} };

    const orders = await this._orders([...unique.keys()]).catch((err) => {
      console.warn('[vendor] order lookup failed:', err?.status ?? '', err?.message);
      return null;
    });

    const entries = await pool([...unique.entries()], CONCURRENCY, async ([sku, vendorHint]) => {
      const mine = orders?.get(sku) ?? [];
      const vendor = vendorHint ?? vendorOf(mine[0]?.vendor);
      const catalog = await this._catalogFor(sku, vendor, mine.map((o) => o.link)).catch(() => null);
      return [sku, {
        sku,
        vendor,
        // No listing on a store we can read: its search page, not a guessed product page.
        productUrl: catalog?.url
          ?? (SHOPIFY_STORES[vendor] ? `https://${SHOPIFY_STORES[vendor]}/search?q=${encodeURIComponent(sku)}` : productPageOf({ sku, vendor }))
          ?? null,
        orders: orders ? mine : null,
        // No vendor picture: the tool's drawing, when an order's summary describes hardware
        // ("Socket Head Screw 10-32 Thread Size, 2-1/4\" Long", as McMaster orders do).
        drawing: catalog?.image ? null : drawingFrom(mine),
        catalog: catalog ? { title: catalog.title, price: catalog.price, available: catalog.available, url: catalog.url, hasImage: !!catalog.image } : null,
      }];
    });
    return { results: Object.fromEntries(entries) };
  }

  /** PARTS tickets for these SKUs, newest first: Map<sku, order[]>. */
  async _orders(skus) {
    // SKUs passed SKU_PATTERN, so they hold no quote or backslash.
    const terms = skus.map((sku) => `cf[${PartField.PART_NUMBER.replace('customfield_', '')}] ~ "\\"${sku}\\""`);
    const jql = `project = ${PARTS_PROJECT_KEY} AND (${terms.join(' OR ')}) ORDER BY created DESC`;
    const issues = await this.jiraClient.searchIssues(jql, {
      paginate: false,
      maxResults: 200,
      fields: ['summary', 'status', PartField.PART_NUMBER, PartField.QTY, PartField.PRICE, PartField.VENDOR, PartField.LINK],
    });
    const out = new Map();
    for (const issue of issues ?? []) {
      const f = issue.fields ?? {};
      const sku = String(f[PartField.PART_NUMBER] ?? '').trim().toUpperCase();
      if (!skus.includes(sku)) continue; // the text search matches loosely; keep exact SKUs only
      if (!out.has(sku)) out.set(sku, []);
      out.get(sku).push({
        key: issue.key,
        summary: f.summary ?? '',
        status: f.status?.name ?? null,
        quantity: f[PartField.QTY] ?? null,
        price: f[PartField.PRICE] ?? null,
        vendor: f[PartField.VENDOR] ?? null,
        link: f[PartField.LINK] ?? null,
      });
    }
    return out;
  }

  /** The vendor's listing for a SKU (cached), or null. */
  _catalogFor(sku, vendor, links = []) {
    const hit = this._catalog.get(sku);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
    const promise = this._findListing(sku, vendor, links);
    const entry = { at: Date.now(), ttl: MISSING_TTL_MS, promise };
    this._catalog.set(sku, entry);
    promise.then((found) => { if (found) entry.ttl = FOUND_TTL_MS; }, () => this._catalog.delete(sku));
    return promise;
  }

  /**
   * @throws {Error} when the store asked us to slow down (so "not found" isn't remembered)
   */
  async _findListing(sku, vendor, links) {
    const host = SHOPIFY_STORES[vendor];
    if (host) {
      // 1. The store's search, over SKUs only: an unknown SKU finds nothing.
      const found = await this._searchSku(host, sku);
      if (found) return found;
    }
    if (vendor === 'Rev') {
      const found = await this._revPage(sku);
      if (found) return found;
    }

    // 2. The link a requester put on a PARTS ticket for this SKU.
    for (const link of links) {
      const url = safeUrl(link, STORE_HOSTS);
      const handle = url && /\/products\/([a-z0-9-]+)/i.exec(url.pathname)?.[1];
      if (!handle) continue;
      const product = await this._json(`https://${url.hostname}/products/${encodeURIComponent(handle)}.js`).catch(() => null);
      if (product) return this._listing(url.hostname, product, sku, { trusted: true });
    }
    return null;
  }

  /** A Shopify store's product with this SKU, from its search; null when none. */
  async _searchSku(host, sku) {
    const params = new URLSearchParams({
      q: sku,
      'resources[type]': 'product',
      'resources[limit]': '4',
      'resources[options][fields]': 'variants.sku',
    });
    const answer = await this._json(`https://${host}/search/suggest.json?${params}`);
    const products = (answer?.resources?.results?.products ?? []).filter((p) => /^[a-z0-9-]+$/i.test(p?.handle ?? ''));
    // The product named after the SKU when there is one (WCP: wcp-1706), else the best match.
    const product = products.find((p) => p.handle.toUpperCase() === sku) ?? products[0];
    if (!product) return null;
    // A product whose variants cost different amounts: its price is not this SKU's.
    const lo = dollars(product.price_min ?? product.price);
    const hi = dollars(product.price_max ?? product.price);
    const image = safeUrl(product.image ?? product.featured_image?.url, IMAGE_HOSTS);
    return {
      title: String(product.title ?? '').trim() || sku,
      price: lo !== null && lo === hi ? lo : null,
      available: typeof product.available === 'boolean' ? product.available : null,
      url: `https://${host}/products/${product.handle}`,
      image: image ? image.toString() : null,
    };
  }

  /** REV's product page (www.revrobotics.com/rev-41-1163/), when it names this SKU. */
  async _revPage(sku) {
    if (!/^REV-[\d-]+$/.test(sku)) return null;
    const html = await this._get(`https://${REV_HOST}/${sku.toLowerCase()}/`, 'text/html');
    if (typeof html !== 'string') return null;
    // An unknown SKU redirects (not followed); a page for another product doesn't carry this SKU.
    const skus = [...html.matchAll(/"sku"\s*:\s*"([^"]+)"/g)].map((m) => m[1].trim().toUpperCase());
    if (!skus.includes(sku)) return null;
    const image = safeUrl(metaOf(html, 'og:image'), IMAGE_HOSTS);
    const stock = /"availability"\s*:\s*"[^"]*schema\.org\/(InStock|OutOfStock|PreOrder|BackOrder|SoldOut)"/i.exec(html)?.[1];
    return {
      title: metaOf(html, 'og:title') || sku,
      price: dollars(metaOf(html, 'product:price:amount')),
      available: stock ? /^InStock$/i.test(stock) : null,
      url: `https://${REV_HOST}/${sku.toLowerCase()}/`,
      image: image ? image.toString() : null,
    };
  }

  /**
   * A listing from product JSON (a ticket's link): a variant with the SKU, or
   * the product's handle is the SKU. `trusted`: a person linked it to this SKU.
   */
  _listing(host, product, sku, { trusted = false } = {}) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variant = variants.find((v) => String(v?.sku ?? '').trim().toUpperCase() === sku);
    const named = String(product.handle ?? '').toUpperCase() === sku;
    if (!variant && !named && !trusted) return null;
    // A product with several variants and none of them this SKU: its price is not this SKU's.
    const chosen = variant ?? (variants.length === 1 ? variants[0] : {});
    const price = dollars(chosen.price ?? (variants.length <= 1 ? product.price : null), { cents: true });
    const image = safeUrl(chosen.featured_image?.src ?? product.featured_image ?? product.images?.[0], IMAGE_HOSTS);
    const available = typeof chosen.available === 'boolean' ? chosen.available : (variant || variants.length <= 1 ? (product.available ?? null) : null);
    return {
      title: [product.title, variant && variants.length > 1 ? variant.title : null].filter(Boolean).join(' — '),
      price,
      available,
      url: `https://${host}/products/${product.handle}${variant && variants.length > 1 ? `?variant=${encodeURIComponent(variant.id)}` : ''}`,
      image: image ? image.toString() : null,
    };
  }

  /** GET JSON from a store; null when missing, slow, redirected, too big or not JSON. */
  async _json(url) {
    const body = await this._get(url, 'application/json');
    if (body === null) return null;
    try {
      return typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
      return null;
    }
  }

  /**
   * GET a store page as text; null on any failure but "too many requests".
   * @throws {Error} when the host answered 429, or is still being left alone after one
   */
  async _get(url, accept) {
    const { hostname } = new URL(url);
    const until = this._backoff.get(hostname) ?? 0;
    if (Date.now() < until) throw new Error(`${hostname} asked us to wait`);
    try {
      const res = await this.http.get(url, {
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_JSON_BYTES,
        responseType: 'text',
        headers: { Accept: accept, 'User-Agent': USER_AGENT },
        validateStatus: (s) => s === 200,
      });
      return res.data ?? null;
    } catch (err) {
      if (err?.response?.status !== 429) return null;
      const seconds = Number(err.response.headers?.['retry-after']);
      const wait = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_BACKOFF_MS) : BACKOFF_MS;
      this._backoff.set(hostname, Date.now() + wait);
      console.warn(`[vendor] ${hostname} answered 429; leaving it alone for ${Math.round(wait / 1000)} s`);
      throw new Error(`${hostname} asked us to wait`);
    }
  }

  /**
   * The listing's picture, small, as bytes.
   * @param {string} sku
   * @param {{ large?: boolean }} [options]  A bigger picture, for the enlarged view
   * @returns {Promise<{ image: Buffer, contentType: string } | null>}
   */
  async image(sku, { large = false } = {}) {
    const key = String(sku ?? '').trim().toUpperCase();
    if (!SKU_PATTERN.test(key)) return null;
    const cacheKey = large ? `${key}:L` : key;
    const hit = this._images.get(cacheKey);
    if (hit && Date.now() - hit.at < FOUND_TTL_MS) return hit.promise;

    const promise = (async () => {
      // Usually looked up by the page a moment ago; after a restart, look it up now.
      const listing = await (this._catalog.get(key)?.promise
        ?? this._catalogFor(key, skuOf({ partNumber: key })?.vendor ?? null)).catch(() => null);
      const url = safeUrl(listing?.image, IMAGE_HOSTS);
      if (!url) return null;
      // Shopify's CDN sizes a picture to order; REV's pictures come one size (500 px).
      if (url.hostname === SHOPIFY_CDN) url.searchParams.set('width', large ? '1200' : '300');
      const res = await this.http.get(url.toString(), {
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_IMAGE_BYTES,
        responseType: 'arraybuffer',
        validateStatus: (s) => s === 200,
      });
      const contentType = String(res.headers?.['content-type'] ?? '');
      if (!/^image\/(png|jpeg|webp|gif)$/.test(contentType.split(';')[0].trim())) return null;
      return { image: Buffer.from(res.data), contentType: contentType.split(';')[0].trim() };
    })().catch(() => null);

    this._images.set(cacheKey, { at: Date.now(), promise });
    promise.then((r) => { if (!r) this._images.delete(cacheKey); });
    if (this._images.size > MAX_IMAGES) this._images.delete(this._images.keys().next().value);
    return promise;
  }
}
