import { existsSync, readFileSync } from 'node:fs';
import { domainInfo } from '../domain';
import { dataFileCandidates, trancoRanks } from '../reputation';
import type { SignalOutcome } from './types';

/**
 * Brand-in-domain check (part of signal 6, clone). The store's domain is a well-known brand's name plus only shop
 * words ("rimowa-store.de", "nike-outlet.shop", "shoprimowa.com") but isn't that brand's site → clone warn.
 * Guards: brands = labels of Tranco top-N domains, at least 4 letters, never an ordinary word (data/brand-stopwords.txt,
 * built by scripts/build-brand-stopwords.ts); everything left after removing the brand must be shop words, so
 * "kinderschatz" or "telegram" never match; a store that is itself in the Tranco top 100k is skipped; the brand's own
 * country sites ("rimowa.de") have the same label and never match. Real resellers exist, so this is a warning only.
 */

export const BRAND = {
  /** Brands = registrable domains ranked this high or better in the pinned Tranco list. */
  top: 100_000,
  minLength: 4,
  stopwordsFile: 'brand-stopwords.txt',
} as const;

/** Words a brand-squatting domain adds to the brand (EN / DE / FR, plus country codes). */
export const SHOP_WORDS = new Set(
  `store stores shop shops onlineshop webshop eshop outlet outlets sale sales deal deals discount discounts official
  officialstore offiziell officiel online factory direct mall market markt club boutique kaufen laden magasin soldes
  promo promos cheap buy offer offers angebot angebote clearance express center centre shopping stock lager rabatt
  de eu uk us fr at ch it es nl be pl se dk no fi ie pt cz`
    .split(/\s+/)
    .filter(Boolean),
);

export interface Brand {
  label: string;
  domain: string;
  rank: number;
}
export type BrandLookup = (label: string) => Brand | null;

/** label → best-ranked brand, from a domain → rank map (rank order). */
export function brandIndex(ranks: Map<string, number>, stopwords: Set<string>, top: number = BRAND.top): Map<string, Brand> {
  const out = new Map<string, Brand>();
  for (const [domain, rank] of ranks) {
    if (rank > top) continue;
    const label = domainInfo(domain).siteLabel;
    if (!label || label.length < BRAND.minLength || !/^[a-z0-9]+$/.test(label) || stopwords.has(label)) continue;
    const prev = out.get(label);
    if (!prev || rank < prev.rank) out.set(label, { label, domain, rank });
  }
  return out;
}

/** The brand a store label is built from, if the rest is only shop words. */
export function brandOf(storeLabel: string, lookup: BrandLookup): Brand | null {
  const tokens = storeLabel.toLowerCase().split('-').filter(Boolean);
  const rest = tokens.filter((t) => !SHOP_WORDS.has(t));
  if (rest.length !== 1) return null;
  const core = rest[0]!;
  const candidates: string[] = tokens.length > 1 ? [core] : [];
  // Glued forms: "rimowastore", "shoprimowa".
  for (const w of SHOP_WORDS) {
    if (w.length < 3 || core.length <= w.length) continue;
    if (core.endsWith(w)) candidates.push(core.slice(0, -w.length));
    if (core.startsWith(w)) candidates.push(core.slice(w.length));
  }
  let best: Brand | null = null;
  for (const c of candidates) {
    const b = lookup(c);
    if (b && b.label !== storeLabel && (!best || b.label.length > best.label.length)) best = b;
  }
  return best;
}

export interface BrandHit {
  brand: Brand;
  evidence: string;
}

/** null when the store is itself well known (any Tranco top-100k rank) or no brand is involved. */
export function brandInDomain(url: string, lookup: BrandLookup | null, ownRank: number | null): BrandHit | null {
  if (!lookup || ownRank !== null) return null;
  const label = domainInfo(url).siteLabel;
  const brand = label ? brandOf(label, lookup) : null;
  if (!brand) return null;
  return {
    brand,
    evidence: `Uses the brand name "${brand.label}" but isn't ${brand.label}'s site (${brand.domain}, #${brand.rank.toLocaleString('en-US')} in the Tranco top-sites list). Real resellers exist, so this alone is a warning, not proof.`,
  };
}

/** Folds a hit into the clone outcome: at least warn, evidence first. */
export function withBrandHit(clone: SignalOutcome, hit: BrandHit | null): SignalOutcome {
  if (!hit) return clone;
  const evidence = clone.status === 'unavailable' ? [hit.evidence] : [hit.evidence, ...clone.evidence];
  return { ...clone, status: clone.status === 'fail' ? 'fail' : 'warn', evidence: evidence.slice(0, 20) };
}

let cached: BrandLookup | null | undefined;

/** The brand index from the pinned Tranco list + stopword file, built once per process. null if either is missing. */
export function defaultBrandLookup(): BrandLookup | null {
  if (cached !== undefined) return cached;
  cached = null;
  const ranks = trancoRanks();
  const path = dataFileCandidates(BRAND.stopwordsFile, undefined).find((p) => existsSync(p));
  if (ranks && path) {
    const index = brandIndex(ranks, new Set(readFileSync(path, 'utf8').split('\n').filter(Boolean)));
    cached = (label) => index.get(label) ?? null;
  }
  return cached;
}
