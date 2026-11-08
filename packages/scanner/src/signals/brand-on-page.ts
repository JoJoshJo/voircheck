import { domainInfo } from '../domain';
import type { PageFacts } from '../page-facts';
import type { SignalOutcome } from './types';

/**
 * Retailer-on-page check (part of signal 6, clone). A page that presents itself as a well-known retailer (Costco,
 * Walmart, Amazon, ...) in its site name, logo or banner, on a web address that isn't that retailer's, is borrowing
 * that store's identity → clone fail, with the words as evidence.
 *
 * Only store identities count: a product's maker (Canon on a camera page) is not a copycat, so this list holds
 * retailers only, and the product title / H1 is never read. Banner text is skipped where the name follows "on",
 * "at", "via", ... ("Also available on Amazon"). A site in the Tranco top 100k is never flagged (its own pages and
 * partners mention retailers).
 */

export interface Retailer {
  name: string;
  /** Lower-case phrases that name the store (word-bounded). */
  names: string[];
  /** Registrable-domain names (before the suffix) that are this retailer's own sites. */
  domains: string[];
  /** The name is also an ordinary word ("target", "saturn"): only its capitalised form counts. */
  capitalOnly?: boolean;
}

export const RETAILERS: Retailer[] = [
  { name: 'Costco', names: ['costco'], domains: ['costco'] },
  { name: 'Walmart', names: ['walmart'], domains: ['walmart', 'walmartimages'] },
  { name: 'Amazon', names: ['amazon'], domains: ['amazon', 'amzn', 'audible', 'wholefoodsmarket'] },
  { name: 'Target', names: ['target'], domains: ['target'], capitalOnly: true },
  { name: 'Best Buy', names: ['best buy', 'bestbuy'], domains: ['bestbuy'] },
  { name: "Sam's Club", names: ["sam's club", 'sams club'], domains: ['samsclub'] },
  { name: 'The Home Depot', names: ['home depot'], domains: ['homedepot'] },
  { name: "Lowe's", names: ["lowe's"], domains: ['lowes'] },
  { name: "Kohl's", names: ["kohl's"], domains: ['kohls'] },
  { name: "Macy's", names: ["macy's"], domains: ['macys'] },
  { name: 'Wayfair', names: ['wayfair'], domains: ['wayfair'] },
  { name: 'Newegg', names: ['newegg'], domains: ['newegg'] },
  { name: 'eBay', names: ['ebay'], domains: ['ebay'] },
  { name: 'Walgreens', names: ['walgreens'], domains: ['walgreens'] },
  { name: 'CVS', names: ['cvs pharmacy'], domains: ['cvs'] },
  { name: 'Kroger', names: ['kroger'], domains: ['kroger'] },
  { name: 'B&H Photo', names: ['b&h photo'], domains: ['bhphotovideo'] },
  { name: 'Lidl', names: ['lidl'], domains: ['lidl'] },
  { name: 'Aldi', names: ['aldi'], domains: ['aldi', 'aldi-nord', 'aldi-sued', 'aldi-suisse'] },
  { name: 'Tesco', names: ['tesco'], domains: ['tesco'] },
  { name: 'Argos', names: ['argos'], domains: ['argos'], capitalOnly: true },
  { name: 'Currys', names: ['currys'], domains: ['currys'] },
  { name: 'John Lewis', names: ['john lewis'], domains: ['johnlewis'] },
  { name: "Sainsbury's", names: ["sainsbury's"], domains: ['sainsburys'] },
  { name: 'Carrefour', names: ['carrefour'], domains: ['carrefour'] },
  { name: 'Auchan', names: ['auchan'], domains: ['auchan'] },
  { name: 'E.Leclerc', names: ['e.leclerc', 'leclerc'], domains: ['e-leclerc', 'leclerc'] },
  { name: 'Fnac', names: ['fnac'], domains: ['fnac'] },
  { name: 'Darty', names: ['darty'], domains: ['darty'] },
  { name: 'Cdiscount', names: ['cdiscount'], domains: ['cdiscount'] },
  { name: 'Boulanger', names: ['boulanger'], domains: ['boulanger'], capitalOnly: true },
  { name: 'MediaMarkt', names: ['mediamarkt', 'media markt'], domains: ['mediamarkt'] },
  { name: 'Saturn', names: ['saturn'], domains: ['saturn'], capitalOnly: true },
  { name: 'Otto', names: ['otto.de'], domains: ['otto'] },
  { name: 'Kaufland', names: ['kaufland'], domains: ['kaufland'] },
  { name: 'Zalando', names: ['zalando'], domains: ['zalando'] },
  { name: 'IKEA', names: ['ikea'], domains: ['ikea'] },
  { name: 'Temu', names: ['temu'], domains: ['temu'] },
  { name: 'Shein', names: ['shein'], domains: ['shein'] },
  { name: 'AliExpress', names: ['aliexpress'], domains: ['aliexpress'] },
];

/** Words that, right before a retailer's name, mean the page mentions that store rather than claims to be it. */
const MENTION_BEFORE = /\b(on|at|via|from|like|than|vs|versus|also|in|auf|bei|sur|chez|comme|wie)\s+(the\s+)?$/i;
/** Words that, right after a retailer's name, make it a payment method or service, not a store identity ("Amazon Pay"). */
const SERVICE_AFTER = /^[\s-]*(pay|payments?|prime|gift\s?cards?|marketplace|seller|affiliate|associate)\b/i;

export interface RetailerHit {
  retailer: Retailer;
  where: 'site name' | 'logo' | 'banner';
  quote: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findName(text: string, r: Retailer, banner: boolean): string | null {
  for (const n of r.names) {
    const word = r.capitalOnly ? n[0]!.toUpperCase() + n.slice(1) : n;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(word)})(?=$|[^\\p{L}\\p{N}])`, r.capitalOnly ? 'gu' : 'giu');
    for (const m of text.matchAll(re)) {
      const at = m.index! + m[1]!.length;
      if (banner && MENTION_BEFORE.test(text.slice(Math.max(0, at - 20), at))) continue;
      // A checkout logo ("Amazon Pay", "Walmart Pay") or a marketplace badge names a service the shop uses.
      if (SERVICE_AFTER.test(text.slice(at + m[2]!.length, at + m[2]!.length + 24))) continue;
      const start = Math.max(0, at - 60);
      return text.slice(start, Math.min(text.length, at + n.length + 60)).trim();
    }
  }
  return null;
}

/** A well-known retailer named in this page's site name, logo or banner, on a site that isn't that retailer's. */
export function retailerOnPage(input: { url: string; siteName: string | null; title?: string | null; facts: PageFacts | null | undefined; wellKnownRank?: number | null }): RetailerHit | null {
  if (input.wellKnownRank != null) return null;
  const d = domainInfo(input.url);
  const own = (d.registrable ?? d.hostname).toLowerCase();
  const ownLabel = own.split('.')[0]!;
  const spots: Array<{ where: RetailerHit['where']; text: string }> = [
    // A "site name" that is just the whole page title is the product's name ("Amazon Echo Dot"), not the shop's.
    ...(input.siteName && input.siteName !== input.title ? [{ where: 'site name' as const, text: input.siteName }] : []),
    ...(input.facts?.logoAlts ?? []).map((t) => ({ where: 'logo' as const, text: t })),
    ...(input.facts?.bannerText ? [{ where: 'banner' as const, text: input.facts.bannerText }] : []),
  ];
  for (const r of RETAILERS) {
    if (r.domains.some((x) => ownLabel === x || ownLabel.startsWith(`${x}-`))) continue;
    for (const s of spots) {
      const quote = findName(s.text, r, s.where === 'banner');
      if (quote) return { retailer: r, where: s.where, quote };
    }
  }
  return null;
}

/** Adds a retailer-on-page hit to the clone outcome: it fails, with the words and where they were. */
export function withRetailerHit(clone: SignalOutcome, hit: RetailerHit | null, url: string): SignalOutcome {
  if (!hit) return clone;
  const site = domainInfo(url).registrable ?? new URL(url).hostname;
  const line = `This page presents itself as ${hit.retailer.name} (${hit.where}: "${hit.quote}"), but its address is ${site}, not ${hit.retailer.name}'s. Fake shops often borrow a big store's name.`;
  const kept = clone.status === 'unavailable' ? [] : clone.evidence;
  return { ...clone, status: 'fail', evidence: [line, ...kept] };
}
