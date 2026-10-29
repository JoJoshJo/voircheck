import { STORES, type ProductId, type StoreConfig } from '@voircheck/shared/stores';
import { searchProducts, type Channel3Options, type SearchOutcome, type SearchResult } from './channel3';

/** Stores per item (spec 5.4). */
export const STORES_PER_ITEM = 3;

const isNew = (r: SearchResult) => r.condition === 'new' || r.condition === null;

/**
 * Top N distinct stores for one item. In-stock only; new-condition offers first (a used price would make an
 * honest store look "too cheap" to the price signal), cheapest first within the top-ranked product, then
 * the next products if the first has too few stores. Used/refurbished offers only fill what's left.
 */
export function pickStoresForItem(results: SearchResult[], n = STORES_PER_ITEM, excludeDomains: string[] = []): { picks: SearchResult[]; sameProduct: boolean } {
  const usable = results.filter((r) => r.availability === 'in_stock');
  const productOrder = [...new Set(usable.map((r) => r.productId))];
  const taken = new Set(excludeDomains);
  const picks: SearchResult[] = [];

  for (const wantNew of [true, false]) {
    for (const pid of productOrder) {
      const offers = usable.filter((r) => r.productId === pid && isNew(r) === wantNew).sort((a, b) => a.price - b.price);
      for (const o of offers) {
        if (picks.length >= n) break;
        if (taken.has(o.storeDomain)) continue;
        taken.add(o.storeDomain);
        picks.push(o);
      }
    }
  }
  return { picks, sameProduct: new Set(picks.map((p) => p.productId)).size <= 1 };
}

// ---------- demo mode ----------

const DEMO_ITEM_WORDS: Array<[ProductId, RegExp]> = [
  ['earbuds', /\b(ear ?buds?|earphones?|headphones?|in-ear|buds)\b/i],
  ['purifier', /\b(air )?purifiers?\b|\bhepa\b/i],
  ['watch', /\b(smart ?watch(es)?|watch(es)?|fitness tracker)\b/i],
];

export function demoItemFor(query: string): ProductId | null {
  return DEMO_ITEM_WORDS.find(([, re]) => re.test(query))?.[0] ?? null;
}

export const DEFAULT_DEMO_STORES_BASE_URL = 'https://voircheck-stores.onrender.com';

function demoStoreUrl(store: StoreConfig, baseUrl: string): string {
  return store.hosts[0] ? `https://${store.hosts[0]}/` : `${baseUrl.replace(/\/$/, '')}/s/${store.slug}`;
}

/** The demo pair's two stores (legit first) for this item, as search results. */
export function demoResults(item: ProductId, pair: 1 | 2 | 3, baseUrl = DEFAULT_DEMO_STORES_BASE_URL): SearchResult[] {
  return STORES.filter((s) => s.pair === pair)
    .sort((a, b) => (a.role === 'legit' ? -1 : b.role === 'legit' ? 1 : 0))
    .map((store) => {
      const product = store.products.find((p) => p.id === item)!;
      const storeUrl = demoStoreUrl(store, baseUrl);
      const url = new URL(storeUrl);
      return {
        source: 'demo' as const,
        productId: `demo:${product.id}`,
        title: product.name,
        price: product.price,
        compareAtPrice: null,
        currency: 'USD',
        storeName: store.name,
        storeDomain: url.hostname,
        storeUrl,
        productUrl: `${storeUrl.replace(/\/$/, '')}/products/${product.slug}`,
        imageUrl: null,
        availability: 'in_stock' as const,
        condition: 'new' as const,
        demoStoreSlug: store.slug,
      };
    });
}

export interface CompareOptions extends Channel3Options {
  demoMode: boolean;
  demoPair?: 1 | 2 | 3;
  demoStoresBaseUrl?: string;
  searchLimit?: number;
}

export type CompareOutcome =
  | {
      status: 'ok';
      stores: SearchResult[];
      /** False when the stores are listings of different (similar) products. */
      sameProduct: boolean;
      /** What Channel3 itself returned, so the agent can be honest when the real retailer is missing. */
      channel3: SearchOutcome['status'];
      channel3Reason?: string;
      /** Demo mode was on but the item isn't in the 3-item demo catalog. */
      demoSkipped?: boolean;
    }
  | { status: 'no_results'; query: string }
  | { status: 'unavailable'; reason: string };

/**
 * Stores to compare for one item. Demo mode ON + item in the demo catalog: legit demo store, scam demo
 * store, and one real Channel3 retailer. Otherwise: the top 3 real Channel3 retailers.
 */
export async function compareStores(query: string, opts: CompareOptions): Promise<CompareOutcome> {
  const real = await searchProducts(query, opts.searchLimit ?? 20, opts);
  const item = opts.demoMode ? demoItemFor(query) : null;

  if (item) {
    const demo = demoResults(item, opts.demoPair ?? 1, opts.demoStoresBaseUrl);
    const extra = real.status === 'ok' ? pickStoresForItem(real.results, STORES_PER_ITEM - demo.length).picks : [];
    return {
      status: 'ok',
      stores: [...demo, ...extra],
      sameProduct: extra.length === 0,
      channel3: real.status,
      ...(real.status === 'unavailable' ? { channel3Reason: real.reason } : {}),
    };
  }

  if (real.status !== 'ok') return real.status === 'no_results' ? real : { status: 'unavailable', reason: real.reason };
  const { picks, sameProduct } = pickStoresForItem(real.results);
  if (!picks.length) return { status: 'no_results', query };
  return { status: 'ok', stores: picks, sameProduct, channel3: 'ok', ...(opts.demoMode ? { demoSkipped: true } : {}) };
}

// ---------- check-a-link peers (demo stores) ----------

/**
 * A pasted link has no comparison set, so the price and clone signals would have nothing to compare. For our own
 * demo stores (Demo mode ON), compare against all five other demo stores on the same page (home, product or about),
 * with the store's hero product (or the product page's item) as the shared item. The caller adds each peer's own
 * latest verdict (from our scans) so the scanner can leave BLOCK stores out of the price median; the clone check still
 * sees them. Real URLs: no peers yet.
 */
export function demoPeersForUrl(
  rawUrl: string,
  baseUrl = DEFAULT_DEMO_STORES_BASE_URL,
): { slug: string; storeName: string; storeUrl: string; productTitle: string; price: number; peers: Array<{ url: string; storeUrl: string; productTitle: string }> } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const base = new URL(baseUrl);
  const hosted = STORES.find((s) => s.hosts.some((h) => h.toLowerCase() === url.hostname.toLowerCase()));
  const m = url.hostname === base.hostname ? url.pathname.match(/^\/s\/([^/]+)(\/.*)?$/) : null;
  const store = hosted ?? (m ? STORES.find((s) => s.slug === m[1]) : undefined);
  if (!store) return null;
  const rest = hosted ? url.pathname.replace(/\/$/, '') : (m?.[2] ?? '').replace(/\/$/, '');

  // Twin first (it matters most for the copycat check), then the other pairs. Never the store itself.
  const others = [...STORES.filter((s) => s.pair === store.pair && s.slug !== store.slug), ...STORES.filter((s) => s.pair !== store.pair)];
  const hero = store.products[0]!;
  const product = store.products.find((p) => rest === `/products/${p.slug}`) ?? hero;
  const productTitle = product.name;
  return {
    slug: store.slug,
    storeName: store.name,
    storeUrl: demoStoreUrl(store, baseUrl),
    productTitle,
    // The demo store's own price for the item, from our config (never from the browser).
    price: product.price,
    peers: others.map((s) => ({ url: `${demoStoreUrl(s, baseUrl).replace(/\/$/, '')}${rest}`, storeUrl: demoStoreUrl(s, baseUrl), productTitle })),
  };
}
