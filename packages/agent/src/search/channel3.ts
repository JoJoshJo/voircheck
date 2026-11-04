import { z } from 'zod';

/**
 * Channel3 product search (spec 5.4). Real API calls only: never fake or pad results.
 * API: https://api.trychannel3.com, header `x-api-key`, POST /v1/search, GET /v1/products/{id}
 * (fields checked against Channel3's OpenAPI reference, Oct 28 2026).
 */

export const CHANNEL3_BASE_URL = 'https://api.trychannel3.com';
export const MAX_LIMIT = 30; // API max; default 20

// ---------- API response shapes (only the fields we use; extra fields are ignored) ----------

const Price = z.object({ price: z.number(), compare_at_price: z.number().nullish(), currency: z.string() });
const Offer = z.object({
  url: z.string(),
  domain: z.string(),
  price: Price,
  availability: z.string(),
  condition: z.string().nullish(),
});
const Image = z.object({ url: z.string(), cleaned_url: z.string().nullish(), is_main_image: z.boolean().nullish(), alt_text: z.string().nullish() });
/** Channel3 sometimes sends availability as the string "true"/"false" (seen live, Nov 4 2026). Anything else: unknown. */
const LooseBool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : typeof v === 'boolean' || v == null ? v : null), z.boolean().nullish());
const VariantOption = z.object({
  name: z.string(),
  values: z.array(z.object({ label: z.string(), available: LooseBool, product_id: z.string().nullish() })).default([]),
});
export const Channel3Product = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  brands: z.array(z.object({ id: z.string().nullish(), name: z.string() })).nullish(),
  images: z.array(Image).nullish(),
  offers: z.array(Offer).nullish(),
  variants: z.object({ options: z.array(VariantOption).default([]), selected: z.array(z.object({ name: z.string(), label: z.string() })).default([]) }).nullish(),
});
export type Channel3Product = z.infer<typeof Channel3Product>;
// Products are checked one by one: a product with an odd field is skipped, it never sinks the whole search.
const SearchResponse = z.object({ products: z.array(z.unknown()), next_page_token: z.string().nullish() });

// ---------- normalized results ----------

export type Availability = 'in_stock' | 'out_of_stock';
export type Condition = 'new' | 'used' | 'refurbished' | null;

/** One store's listing for one item. Channel3 calls this an offer. */
export interface SearchResult {
  source: 'channel3' | 'demo';
  productId: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  storeName: string;
  storeDomain: string;
  storeUrl: string;
  /** Channel3 returns an attributed buy link (it redirects to the retailer). */
  productUrl: string;
  imageUrl: string | null;
  availability: Availability;
  condition: Condition;
  /** Demo stores only. */
  demoStoreSlug?: string;
}

export type SearchOutcome =
  | { status: 'ok'; results: SearchResult[] }
  | { status: 'no_results'; query: string }
  | { status: 'unavailable'; reason: string; httpStatus?: number };

export interface Channel3Options {
  apiKey: string | undefined;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Reuse recent search results (createSearchCache). Off unless given. */
  cache?: SearchCache;
}

/**
 * Recent Channel3 results, in memory, so the same search within 10 minutes (a follow-up, another person trying the
 * example) doesn't wait 1-2 s or spend a call. Only successful searches are kept; errors and "no results" ask again.
 * Prices can move in 10 minutes, but the order uses the price stored when the stores were listed, as before.
 */
export interface SearchCache {
  get(key: string): SearchResult[] | undefined;
  set(key: string, results: SearchResult[]): void;
}

export const SEARCH_CACHE_TTL_MS = 10 * 60_000;
export const SEARCH_CACHE_MAX = 200;

export function createSearchCache(o: { ttlMs?: number; max?: number; now?: () => number } = {}): SearchCache {
  const ttl = o.ttlMs ?? SEARCH_CACHE_TTL_MS;
  const max = o.max ?? SEARCH_CACHE_MAX;
  const now = o.now ?? Date.now;
  const map = new Map<string, { at: number; results: SearchResult[] }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at >= ttl) {
        map.delete(key);
        return undefined;
      }
      return hit.results.map((r) => ({ ...r }));
    },
    set(key, results) {
      map.delete(key);
      map.set(key, { at: now(), results: results.map((r) => ({ ...r })) });
      // Oldest first out (Map keeps insertion order).
      while (map.size > max) map.delete(map.keys().next().value!);
    },
  };
}

/** Same search = same text (case and spacing aside), same limit, same API. */
export const searchCacheKey = (q: string, limit: number, baseUrl = CHANNEL3_BASE_URL) => `${baseUrl}|${limit}|${q.toLowerCase().replace(/\s+/g, ' ')}`;

const bareDomain = (d: string) => d.trim().toLowerCase().replace(/^www\./, '');

function mainImage(p: Channel3Product): string | null {
  const imgs = p.images ?? [];
  const img = imgs.find((i) => i.is_main_image) ?? imgs[0];
  return img ? (img.cleaned_url ?? img.url) : null;
}

function normalizeCondition(c: string | null | undefined): Condition {
  return c === 'new' || c === 'used' || c === 'refurbished' ? c : null;
}

/** Flatten products × offers into store listings, keeping Channel3's ranking order. */
export function normalizeProducts(products: Channel3Product[]): SearchResult[] {
  const out: SearchResult[] = [];
  for (const p of products) {
    for (const o of p.offers ?? []) {
      const domain = bareDomain(o.domain);
      if (!domain || !Number.isFinite(o.price.price) || o.price.price <= 0) continue;
      out.push({
        source: 'channel3',
        productId: p.id,
        title: p.title,
        price: o.price.price,
        compareAtPrice: o.price.compare_at_price ?? null,
        currency: o.price.currency.toUpperCase(),
        storeName: domain,
        storeDomain: domain,
        storeUrl: `https://${domain}/`,
        productUrl: o.url,
        imageUrl: mainImage(p),
        availability: o.availability === 'OutOfStock' ? 'out_of_stock' : 'in_stock',
        condition: normalizeCondition(o.condition),
      });
    }
  }
  return out;
}

async function call(path: string, init: RequestInit, opts: Channel3Options): Promise<{ ok: true; json: unknown } | { ok: false; reason: string; httpStatus?: number }> {
  if (!opts.apiKey) return { ok: false, reason: 'Channel3 is not configured' };
  try {
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl ?? CHANNEL3_BASE_URL}${path}`, {
      ...init,
      headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) {
      const reason =
        res.status === 401 ? 'Channel3 rejected the API key' : res.status === 402 ? 'Channel3 credits are used up' : res.status === 429 ? 'Channel3 rate limit reached' : `Channel3 error (HTTP ${res.status})`;
      return { ok: false, reason, httpStatus: res.status };
    }
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error && err.name === 'TimeoutError' ? 'Channel3 timed out' : "Couldn't reach Channel3" };
  }
}

export async function searchProducts(query: string, limit: number, opts: Channel3Options): Promise<SearchOutcome> {
  const q = query.trim().slice(0, 500);
  if (!q) return { status: 'no_results', query };
  const n = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
  const key = opts.cache && opts.apiKey ? searchCacheKey(q, n, opts.baseUrl) : null;
  const cached = key ? opts.cache!.get(key) : undefined;
  if (cached) return { status: 'ok', results: cached };
  const res = await call('/v1/search', { method: 'POST', body: JSON.stringify({ query: q, limit: n }) }, opts);
  if (!res.ok) return { status: 'unavailable', reason: res.reason, httpStatus: res.httpStatus };
  const parsed = SearchResponse.safeParse(res.json);
  if (!parsed.success) return { status: 'unavailable', reason: 'Channel3 returned an unexpected response' };
  const products = parsed.data.products.flatMap((p) => {
    const one = Channel3Product.safeParse(p);
    return one.success ? [one.data] : [];
  });
  const results = normalizeProducts(products);
  if (key && results.length) opts.cache!.set(key, results);
  return results.length ? { status: 'ok', results } : { status: 'no_results', query: q };
}

// ---------- enrichment ----------

export interface ProductDetail {
  productId: string;
  title: string;
  description: string | null;
  brand: string | null;
  images: Array<{ url: string; alt: string | null }>;
  variants: Array<{ name: string; values: Array<{ label: string; available: boolean | null }> }>;
  offers: SearchResult[];
}

export type DetailOutcome = { status: 'ok'; detail: ProductDetail } | { status: 'not_found'; productId: string } | { status: 'unavailable'; reason: string; httpStatus?: number };

/** Product enrichment: all images, variant options with availability, and every current offer. */
export async function getProductDetail(productId: string, opts: Channel3Options): Promise<DetailOutcome> {
  const res = await call(`/v1/products/${encodeURIComponent(productId)}`, { method: 'GET' }, opts);
  if (!res.ok) return res.httpStatus === 404 ? { status: 'not_found', productId } : { status: 'unavailable', reason: res.reason, httpStatus: res.httpStatus };
  const parsed = Channel3Product.safeParse(res.json);
  if (!parsed.success) return { status: 'unavailable', reason: 'Channel3 returned an unexpected response' };
  const p = parsed.data;
  return {
    status: 'ok',
    detail: {
      productId: p.id,
      title: p.title,
      description: p.description ?? null,
      brand: p.brands?.[0]?.name ?? null,
      images: (p.images ?? []).map((i) => ({ url: i.cleaned_url ?? i.url, alt: i.alt_text ?? null })),
      variants: (p.variants?.options ?? []).map((o) => ({ name: o.name, values: o.values.map((v) => ({ label: v.label, available: v.available ?? null })) })),
      offers: normalizeProducts([p]),
    },
  };
}
