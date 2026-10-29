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
