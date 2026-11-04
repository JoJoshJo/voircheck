import { describe, expect, it, vi } from 'vitest';
import { createSearchCache, getProductDetail, normalizeProducts, SEARCH_CACHE_TTL_MS, searchProducts, type Channel3Product } from './channel3';
import { compareStores, demoItemFor, demoPeersForUrl, demoResults, pickStoresForItem } from './compare';

const offer = (domain: string, price: number, extra: Record<string, unknown> = {}) => ({
  url: `https://www.buy.trychannel3.com/r/${domain}`,
  domain,
  price: { price, compare_at_price: null, currency: 'usd' },
  availability: 'InStock',
  condition: 'new',
  max_commission_rate: 0.05,
  ...extra,
});

const PRODUCTS: Channel3Product[] = [
  {
    id: 'p1',
    title: 'Acme Buds Pro',
    images: [
      { url: 'https://img/1.jpg', cleaned_url: null, is_main_image: false },
      { url: 'https://img/2.jpg', cleaned_url: 'https://cdn/2-clean.png', is_main_image: true },
    ],
    offers: [offer('www.BestStore.com', 79.99), offer('shopb.com', 74.5), offer('soldout.com', 60, { availability: 'OutOfStock' }), offer('usedgear.com', 40, { condition: 'used' })],
  },
  { id: 'p2', title: 'Acme Buds Lite', images: [], offers: [offer('shopc.com', 49), offer('shopb.com', 45)] },
];

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const opts = (f: typeof fetch) => ({ apiKey: 'test-key', fetch: f });

describe('searchProducts', () => {
  it('calls POST /v1/search with x-api-key and a capped limit', async () => {
    const f = mockFetch(200, { products: PRODUCTS, next_page_token: null });
    await searchProducts('wireless earbuds', 99, opts(f));
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.trychannel3.com/v1/search');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-api-key': 'test-key' });
    expect(JSON.parse(init.body as string)).toEqual({ query: 'wireless earbuds', limit: 30 });
  });

  it('normalizes products × offers into store listings', async () => {
    const r = await searchProducts('earbuds', 10, opts(mockFetch(200, { products: PRODUCTS })));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.results).toHaveLength(6);
    expect(r.results[0]).toEqual({
      source: 'channel3',
      productId: 'p1',
      title: 'Acme Buds Pro',
      price: 79.99,
      compareAtPrice: null,
      currency: 'USD',
      storeName: 'beststore.com',
      storeDomain: 'beststore.com',
      storeUrl: 'https://beststore.com/',
      productUrl: 'https://www.buy.trychannel3.com/r/www.BestStore.com',
      imageUrl: 'https://cdn/2-clean.png',
      availability: 'in_stock',
      condition: 'new',
    });
    expect(r.results[2]?.availability).toBe('out_of_stock');
  });

  it('empty catalog → typed no_results (never faked)', async () => {
    expect(await searchProducts('zzzz', 5, opts(mockFetch(200, { products: [] })))).toEqual({ status: 'no_results', query: 'zzzz' });
    expect((await searchProducts('   ', 5, opts(mockFetch(200, { products: PRODUCTS })))).status).toBe('no_results');
  });

  it.each([
    [401, 'Channel3 rejected the API key'],
    [402, 'Channel3 credits are used up'],
    [429, 'Channel3 rate limit reached'],
    [500, 'Channel3 error (HTTP 500)'],
  ])('HTTP %i → unavailable (%s)', async (status, reason) => {
    expect(await searchProducts('earbuds', 5, opts(mockFetch(status, { detail: 'x' })))).toEqual({ status: 'unavailable', reason, httpStatus: status });
  });

  it('one malformed product is skipped, never the whole search (live wig search, Nov 4: available: "true")', async () => {
    const odd = { id: 'p3', title: 'Wig 20 inch', offers: [offer('wigs.com', 99)], variants: { options: [{ name: 'Length', values: [{ label: '20', available: 'true' }, { label: '22', available: 'false' }] }] } };
    const broken = { id: 'p4', title: 'No offers shape', offers: [{ url: 1 }] };
    const r = await searchProducts('wig', 10, opts(mockFetch(200, { products: [odd, broken, ...PRODUCTS] })));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.results.map((x) => x.storeDomain)).toEqual(['wigs.com', 'beststore.com', 'shopb.com', 'soldout.com', 'usedgear.com', 'shopc.com', 'shopb.com']);
  });

  it('network error, malformed body, or missing key → unavailable', async () => {
    const boom = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await searchProducts('earbuds', 5, opts(boom))).toMatchObject({ status: 'unavailable', reason: "Couldn't reach Channel3" });
    expect(await searchProducts('earbuds', 5, opts(mockFetch(200, { items: [] })))).toMatchObject({ status: 'unavailable' });
    expect(await searchProducts('earbuds', 5, { apiKey: undefined, fetch: mockFetch(200, {}) })).toMatchObject({ status: 'unavailable', reason: 'Channel3 is not configured' });
  });
});

describe('product enrichment', () => {
  it('returns images, variants and offers from GET /v1/products/{id}', async () => {
    const f = mockFetch(200, {
      ...PRODUCTS[0],
      brands: [{ id: 'b1', name: 'Acme' }],
      variants: { options: [{ name: 'Color', values: [{ label: 'Black', available: true }, { label: 'White', available: false }] }], selected: [{ name: 'Color', label: 'Black' }] },
    });
    const r = await getProductDetail('p1', opts(f));
    expect((f.mock.calls[0] as [string])[0]).toBe('https://api.trychannel3.com/v1/products/p1');
    expect(r).toMatchObject({
      status: 'ok',
      detail: { brand: 'Acme', images: [{ url: 'https://img/1.jpg' }, { url: 'https://cdn/2-clean.png' }], variants: [{ name: 'Color', values: [{ label: 'Black', available: true }, { label: 'White', available: false }] }] },
    });
  });
  it('404 → not_found', async () => {
    expect(await getProductDetail('nope', opts(mockFetch(404, { detail: 'Not found' })))).toEqual({ status: 'not_found', productId: 'nope' });
  });
});

describe('pickStoresForItem', () => {
  const results = normalizeProducts(PRODUCTS);
  it('top 3 distinct in-stock stores, top product first, then fills from the next product', () => {
    const { picks, sameProduct } = pickStoresForItem(results);
    expect(picks.map((p) => [p.storeDomain, p.productId])).toEqual([
      ['shopb.com', 'p1'], // cheapest new offer of the top product
      ['beststore.com', 'p1'],
      ['shopc.com', 'p2'], // shopb.com already used; soldout skipped
    ]);
    expect(sameProduct).toBe(false);
    expect(picks.some((p) => p.storeDomain === 'soldout.com')).toBe(false);
  });
  it('prefers new over used, and never repeats a store', () => {
    const { picks } = pickStoresForItem(results, 10);
    expect(new Set(picks.map((p) => p.storeDomain)).size).toBe(picks.length);
    expect(picks.findIndex((p) => p.storeDomain === 'usedgear.com')).toBeGreaterThan(picks.findIndex((p) => p.storeDomain === 'beststore.com'));
  });
});

describe('demo mode', () => {
  it('maps queries to the 3-item demo catalog', () => {
    expect(demoItemFor('wireless earbuds under $60')).toBe('earbuds');
    expect(demoItemFor('HEPA air purifier')).toBe('purifier');
    expect(demoItemFor('écouteurs sans fil')).toBe('earbuds');
    expect(demoItemFor('une montre connectée')).toBe('watch');
    expect(demoItemFor('smartwatch for running')).toBe('watch');
    expect(demoItemFor('hiking boots')).toBeNull();
  });

  it('demo pair 1 = Velbrook Supply + Velbrook-Outlet Deals with the config prices', () => {
    const [legit, scam] = demoResults('earbuds', 1);
    expect(legit).toMatchObject({ source: 'demo', storeName: 'Velbrook Supply', title: 'Zephlet Buds', price: 59, demoStoreSlug: 'velbrook-supply' });
    expect(scam).toMatchObject({ storeName: 'Velbrook-Outlet Deals', price: 23, productUrl: 'https://voircheck-stores.onrender.com/s/velbrook-outlet-deals/products/zephlet-buds' });
  });

  it('demo ON: 2 demo stores + 1 real Channel3 retailer', async () => {
    const r = await compareStores('wireless earbuds', { ...opts(mockFetch(200, { products: PRODUCTS })), demoMode: true });
    expect(r.status === 'ok' && r.stores.map((s) => s.source)).toEqual(['demo', 'demo', 'channel3']);
  });

  it('demo ON + Channel3 down: still the demo pair, and says Channel3 was unavailable', async () => {
    const r = await compareStores('wireless earbuds', { ...opts(mockFetch(503, {})), demoMode: true });
    expect(r).toMatchObject({ status: 'ok', channel3: 'unavailable', channel3Reason: 'Channel3 error (HTTP 503)' });
    expect(r.status === 'ok' && r.stores).toHaveLength(2);
  });

  it('a budget leaves out offers above it (real and demo)', async () => {
    const r = await compareStores('wireless earbuds', { ...opts(mockFetch(200, { products: PRODUCTS })), demoMode: true, maxPrice: 50 });
    expect(r.status === 'ok' && r.stores.map((s) => [s.storeName, s.price])).toEqual([
      ['Velbrook-Outlet Deals', 23],
      ['shopb.com', 45],
      ['shopc.com', 49], // the demo store over budget leaves room for one more real retailer
    ]);
    expect(await compareStores('earbuds', { ...opts(mockFetch(200, { products: PRODUCTS })), demoMode: false, maxPrice: 10 })).toEqual({ status: 'no_results', query: 'earbuds' });
  });

  it('demo OFF: top 3 real retailers only; errors stay typed', async () => {
    const ok = await compareStores('wireless earbuds', { ...opts(mockFetch(200, { products: PRODUCTS })), demoMode: false });
    expect(ok.status === 'ok' && ok.stores.every((s) => s.source === 'channel3')).toBe(true);
    expect(await compareStores('earbuds', { ...opts(mockFetch(200, { products: [] })), demoMode: false })).toEqual({ status: 'no_results', query: 'earbuds' });
    expect(await compareStores('earbuds', { ...opts(mockFetch(500, {})), demoMode: false })).toMatchObject({ status: 'unavailable' });
  });

  it('demo ON but item not in the demo catalog → real results, flagged', async () => {
    const r = await compareStores('hiking boots', { ...opts(mockFetch(200, { products: PRODUCTS })), demoMode: true });
    expect(r).toMatchObject({ status: 'ok', demoSkipped: true });
  });
});

describe('demoPeersForUrl (check-a-link on a demo store)', () => {
  const B = 'https://voircheck-stores.onrender.com/s';
  it('all five other demo stores (twin first), same page, hero product as the item; never the store itself', () => {
    const r = demoPeersForUrl(`${B}/velbrook-outlet-deals`)!;
    expect(r).toMatchObject({ slug: 'velbrook-outlet-deals', storeName: 'Velbrook-Outlet Deals', storeUrl: `${B}/velbrook-outlet-deals`, productTitle: 'Zephlet Buds', price: 23 });
    expect(r.peers.map((p) => p.url)).toEqual([`${B}/velbrook-supply`, `${B}/ondaya-home`, `${B}/0ndaya-home`, `${B}/nyuie-market`, `${B}/nyuie-market-clearance`]);
    expect(r.peers.every((p) => p.productTitle === 'Zephlet Buds' && p.url === p.storeUrl)).toBe(true);
    expect(r.peers.some((p) => p.url.includes('velbrook-outlet-deals'))).toBe(false);
  });

  it('keeps the product page and its product', () => {
    const r = demoPeersForUrl(`${B}/nyuie-market-clearance/products/nimbair-purifier`)!;
    expect(r).toMatchObject({ productTitle: 'Nimbair Purifier', price: 94 });
    expect(r.peers[0]).toEqual({ url: `${B}/nyuie-market/products/nimbair-purifier`, storeUrl: `${B}/nyuie-market`, productTitle: 'Nimbair Purifier' });
    expect(r.peers).toHaveLength(5);
  });
  it('null for real sites and unknown slugs', () => {
    expect(demoPeersForUrl('https://www.bestbuy.com/site/x')).toBeNull();
    expect(demoPeersForUrl(`${B}/not-a-store`)).toBeNull();
  });
});

describe('Channel3 search cache (10 minutes)', () => {
  it('the same search within 10 minutes is answered from the cache, case and spacing aside; after that Channel3 is asked again', async () => {
    let t = 1_000_000;
    const cache = createSearchCache({ now: () => t });
    const f = mockFetch(200, { products: PRODUCTS });
    const first = await searchProducts('Wireless  earbuds', 20, { ...opts(f), cache });
    const again = await searchProducts('wireless earbuds', 20, { ...opts(f), cache });
    expect(f).toHaveBeenCalledTimes(1);
    expect(again).toEqual(first);
    if (again.status === 'ok') again.results[0]!.price = 1; // a caller changing its copy doesn't change the cache
    expect(await searchProducts('wireless earbuds', 20, { ...opts(f), cache })).toEqual(first);
    await searchProducts('wireless earbuds', 10, { ...opts(f), cache }); // another limit is another search
    expect(f).toHaveBeenCalledTimes(2);
    t += SEARCH_CACHE_TTL_MS;
    await searchProducts('wireless earbuds', 20, { ...opts(f), cache });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('errors and "no results" are not kept, and without a cache every search asks Channel3', async () => {
    const cache = createSearchCache();
    const down = mockFetch(429, {});
    await searchProducts('earbuds', 20, { ...opts(down), cache });
    await searchProducts('earbuds', 20, { ...opts(down), cache });
    expect(down).toHaveBeenCalledTimes(2);
    const none = mockFetch(200, { products: [] });
    await searchProducts('zzzz', 20, { ...opts(none), cache });
    await searchProducts('zzzz', 20, { ...opts(none), cache });
    expect(none).toHaveBeenCalledTimes(2);
    const f = mockFetch(200, { products: PRODUCTS });
    await searchProducts('earbuds', 20, opts(f));
    await searchProducts('earbuds', 20, opts(f));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('keeps at most the newest entries', async () => {
    const cache = createSearchCache({ max: 2 });
    const f = mockFetch(200, { products: PRODUCTS });
    for (const q of ['a', 'b', 'c']) await searchProducts(q, 20, { ...opts(f), cache });
    await searchProducts('a', 20, { ...opts(f), cache }); // dropped as the oldest
    await searchProducts('c', 20, { ...opts(f), cache }); // still cached
    expect(f).toHaveBeenCalledTimes(4);
  });
});
