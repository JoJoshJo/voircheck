import { z } from 'zod';

/**
 * Raw facts the cloud browser collects from a store page, parsed on our server (never trusted as instructions):
 * - the product on sale: JSON-LD Product/offers (first), then meta price tags (og:/product: price, itemprop);
 * - the shop's own identity as shown to people: logo alt text and banner/announcement text (brand-on-page check).
 */

export const PageFacts = z.object({
  ldJson: z.array(z.string().max(20_000)).max(10),
  metaPrice: z.object({ amount: z.string().max(40), currency: z.string().max(10).nullable() }).nullable(),
  metaTitle: z.string().max(500).nullable(),
  logoAlts: z.array(z.string().max(200)).max(12),
  bannerText: z.string().max(1_200),
});
export type PageFacts = z.infer<typeof PageFacts>;

/** Runs in the cloud browser (page.evaluate). Self-contained: no imports, only reads the DOM. */
export const PAGE_FACTS_JS = `() => {
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const ldJson = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 10).map((s) => (s.textContent || '').slice(0, 20000));
  const amount = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]') || meta('meta[itemprop="price"]');
  const currency = meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]') || meta('meta[itemprop="priceCurrency"]');
  const logoSel = 'header img[alt], img[alt*="logo" i], img[class*="logo" i][alt], img[src*="logo" i][alt], [class*="logo" i] img[alt], [class*="banner" i] img[alt], [class*="announcement" i] img[alt]';
  const logoAlts = [...new Set([...document.querySelectorAll(logoSel)].map((i) => clean(i.getAttribute('alt')).slice(0, 200)).filter(Boolean))].slice(0, 12);
  const bannerSel = '[class*="announcement" i], [id*="announcement" i], [class*="banner" i], [class*="topbar" i], [class*="top-bar" i], [class*="promo-bar" i]';
  const bannerText = [...document.querySelectorAll(bannerSel)].slice(0, 8).map((e) => clean(e.innerText)).filter(Boolean).join(' | ').slice(0, 1200);
  return { ldJson, metaPrice: amount ? { amount: amount.slice(0, 40), currency: currency ? currency.slice(0, 10) : null } : null, metaTitle: (meta('meta[property="og:title"]') || '').slice(0, 500) || null, logoAlts, bannerText };
}`;

export interface PageProduct {
  name: string;
  price: number;
  currency: string | null;
  source: 'json-ld' | 'meta' | 'ai';
}

/** "1,299.00" / "1.299,00" / "77" → number; anything else → null. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); // 1.299,00
  else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // 77,50
  else s = s.replace(/,/g, ''); // 1,299.00
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isType = (node: Record<string, unknown>, t: string) => asArray(node['@type']).some((x) => typeof x === 'string' && x.toLowerCase() === t.toLowerCase());

/** Every object in a JSON-LD document (top level, @graph, nested), depth-limited. */
function walk(v: unknown, out: Array<Record<string, unknown>>, depth = 0): void {
  if (depth > 6 || out.length > 200) return;
  if (Array.isArray(v)) for (const x of v) walk(x, out, depth + 1);
  else if (v && typeof v === 'object') {
    out.push(v as Record<string, unknown>);
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x, out, depth + 1);
  }
}

function offerPrice(offers: unknown): { price: number; currency: string | null } | null {
  for (const o of asArray(offers)) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const price = parseAmount(r.price ?? r.lowPrice ?? (r.priceSpecification as Record<string, unknown> | undefined)?.price);
    if (price !== null) return { price, currency: typeof r.priceCurrency === 'string' ? r.priceCurrency.toUpperCase() : null };
  }
  return null;
}

const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/** The product this page sells: JSON-LD Product first, then meta price tags with og:title. Null when neither has a price. */
export function productFromPage(facts: PageFacts | null | undefined, fallbackName?: string | null): PageProduct | null {
  if (!facts) return null;
  for (const raw of facts.ldJson) {
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes: Array<Record<string, unknown>> = [];
    walk(doc, nodes);
    for (const n of nodes) {
      if (!isType(n, 'Product') && !isType(n, 'ProductGroup')) continue;
      const name = typeof n.name === 'string' ? cleanName(n.name) : '';
      const p = offerPrice(n.offers) ?? asArray(n.hasVariant).map((v) => (v && typeof v === 'object' ? offerPrice((v as Record<string, unknown>).offers) : null)).find(Boolean) ?? null;
      if (name && p) return { name, price: p.price, currency: p.currency, source: 'json-ld' };
    }
  }
  const metaAmount = parseAmount(facts.metaPrice?.amount);
  const name = cleanName(facts.metaTitle ?? fallbackName ?? '');
  if (metaAmount !== null && name) return { name, price: metaAmount, currency: facts.metaPrice?.currency?.toUpperCase() ?? null, source: 'meta' };
  return null;
}
