import { unavailable, type SignalOutcome } from './types';

/** Signal 3: too-good-to-be-true price vs the other stores for the same item. */

/**
 * Scores only with ≥3 valid comparison offers for the exact same product; the reference ("typical") is their median.
 * The comparison set never includes the scanned store itself, stores whose own latest verdict is BLOCK, or offers for
 * a different product (scan.ts filters those). Fewer valid offers → "unavailable" (0 points) and no price is shown.
 */
export const PRICE = { failAbovePct: 40, warnAbovePct: 20, minComparisonOffers: 3 } as const;

const PRICE_RE = /(?:US\s?)?[$€£]\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Find the first price shown after the item's title in page text (product cards and product pages put it right below). */
export function findPriceNear(text: string, title: string, windowChars = 400): number | null {
  const hay = text.toLowerCase();
  const needle = title.toLowerCase().trim();
  let from = 0;
  while (needle) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    const m = PRICE_RE.exec(text.slice(at + needle.length, at + needle.length + windowChars));
    if (m?.[1]) return Number(m[1].replace(/,/g, ''));
    from = at + needle.length;
  }
  return null;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function evaluatePrice(input: {
  price: number | null;
  title: string | null;
  /** Valid comparison offers only (already without this store, BLOCK stores and other products). */
  peerPrices: number[];
  sameProduct?: boolean;
  /** How many peers were left out because their own verdict is BLOCK (mentioned, never their prices). */
  excludedBlocked?: number;
}): { outcome: SignalOutcome; belowPct: number | null } {
  const id = 'price' as const;
  const item = input.title ? `"${input.title}"` : 'this item';
  // No numbers in any "unavailable" message: an invalid comparison must not show a price anywhere.
  if (input.sameProduct === false) return { outcome: unavailable(id, 'The other stores sell different products, so prices are not compared.'), belowPct: null };
  if (input.price === null) return { outcome: unavailable(id, `Couldn't find the price of ${item} on this store.`), belowPct: null };
  if (input.peerPrices.length < PRICE.minComparisonOffers) {
    return { outcome: unavailable(id, `Not enough other trustworthy stores sell exactly ${item} to compare prices.`), belowPct: null };
  }

  const ref = median(input.peerPrices);
  const belowPct = Math.round(((ref - input.price) / ref) * 1000) / 10;
  const evidence = [
    `${money(input.price)} here vs ${money(ref)} typical (the median of ${input.peerPrices.length} other stores selling the same item).`,
    belowPct > 0 ? `${belowPct}% below the other stores.` : belowPct < 0 ? `${-belowPct}% above the other stores.` : 'Same as the other stores.',
  ];
  if (input.excludedBlocked) evidence.push('Stores VoirCheck blocked were left out of the comparison.');
  const status = belowPct > PRICE.failAbovePct ? 'fail' : belowPct > PRICE.warnAbovePct ? 'warn' : 'pass';
  if (status === 'fail') evidence.push('A price this far below everyone else is a common sign of a fake shop.');
  return { outcome: { id, status, evidence }, belowPct };
}

// ---------- pasted links: compare with other stores found by product search (Channel3) ----------

/** One offer from a product search, as the caller's search returns it. */
export interface ComparableOffer {
  title: string;
  price: number;
  currency: string | null;
  storeUrl: string;
  /** That store's own latest VoirCheck verdict, if it was scanned. */
  verdict?: 'SAFE' | 'HOLD' | 'BLOCK';
}

/** Search for offers of a product by its name. null = product search isn't available (no key, error). */
export type FindOffers = (productName: string) => Promise<ComparableOffer[] | null>;

/** Words that mark an accessory or part for the item ("case for Canon SX740"), never the item itself. */
const ACCESSORY = /\b(case|cover|sleeve|bag|pouch|strap|battery|batteries|charger|cable|adapter|screen protector|protector|skin|mount|tripod|lens cap|filter|replacement|compatible|for)\b/i;
/** Words that don't identify the product (colours, filler). */
const FILLER = new Set(['the', 'and', 'with', 'for', 'new', 'black', 'white', 'silver', 'grey', 'gray', 'blue', 'red', 'green', 'gold', 'pink', 'edition', 'version', 'inch', 'in', 'of', 'a', 'an', 'de', 'la', 'le', 'et', 'und', 'mit']);

const words = (s: string) => normalizeTitle(s).split(' ').filter((w) => w.length > 1 && !FILLER.has(w));
/** Model numbers and other tokens with digits ("sx740", "wh1000xm5", "128gb"): the item's identity. */
const modelTokens = (ws: string[]) => ws.filter((w) => /\d/.test(w) && /[a-z]/.test(w));

/**
 * Is this offer the same item? Every model number in our item's name must be in the offer's title, at least 60% of
 * our name's words must be there too, and the offer must not be an accessory for it.
 */
export function sameProductTitle(ours: string, theirs: string): boolean {
  const a = words(ours);
  if (a.length < 2) return false;
  const b = new Set(words(theirs));
  if (ACCESSORY.test(theirs) && !ACCESSORY.test(ours)) return false;
  if (!modelTokens(a).every((w) => b.has(w))) return false;
  const shared = a.filter((w) => b.has(w)).length;
  return shared / a.length >= 0.6;
}

const siteOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return u;
  }
};

/**
 * The comparison prices for a pasted link: offers of the same item, in the same currency, from other stores, never a
 * store VoirCheck blocked, one price per store (its lowest).
 */
export function comparablePrices(input: { name: string; currency: string | null; storeUrl: string; offers: ComparableOffer[] }): { prices: number[]; sites: string[]; excludedBlocked: number } {
  const self = siteOf(input.storeUrl);
  const byStore = new Map<string, number>();
  let excludedBlocked = 0;
  for (const o of input.offers) {
    const site = siteOf(o.storeUrl);
    if (site === self || site.endsWith(`.${self}`) || self.endsWith(`.${site}`)) continue;
    if (!Number.isFinite(o.price) || o.price <= 0) continue;
    if (input.currency && o.currency && o.currency.toUpperCase() !== input.currency.toUpperCase()) continue;
    if (!sameProductTitle(input.name, o.title)) continue;
    if (o.verdict === 'BLOCK') {
      excludedBlocked++;
      continue;
    }
    byStore.set(site, Math.min(byStore.get(site) ?? Infinity, o.price));
  }
  return { prices: [...byStore.values()], sites: [...byStore.keys()], excludedBlocked };
}
