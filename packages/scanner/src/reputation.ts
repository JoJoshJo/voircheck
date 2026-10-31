import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { DomainInfo } from './domain';

/**
 * Well-known-site reputation (spec 5.5): the Tranco top-sites research list (tranco-list.eu), pinned to one list ID
 * and stored compactly in the repo (top 100k pay-level domains, one per line in rank order). Never fetched per scan.
 * Evidence only for now. "Well-known" is never "safe": lookalikes still go through the clone check, the list itself
 * contains typo-domains, and shared hosts (onrender.com, myshopify.com...) never lend their rank to the shops on them.
 *
 * Tranco publishes no license for the list; it combines CrUX (CC BY-SA 4.0), Majestic (CC BY 3.0), Umbrella, Farsight
 * and Cloudflare Radar (CC BY-NC 4.0, non-commercial). Fine for the hackathon with attribution; a paid VoirCheck
 * must re-check this or replace the source.
 */
export const TRANCO = {
  listId: '746VX',
  date: '2026-10-30',
  top: 100_000,
  url: 'https://tranco-list.eu/list/746VX',
  file: 'tranco-746VX-top100k.txt.gz',
} as const;

export type RankLookup = (registrableDomain: string) => number | null;

/** Parse the stored list (rank = line number). Placeholder entries like `_wildcard_.ph` are skipped. */
export function parseRanks(text: string): Map<string, number> {
  const ranks = new Map<string, number>();
  text.split('\n').forEach((line, i) => {
    const d = line.trim().toLowerCase();
    if (d && !d.startsWith('_') && !ranks.has(d)) ranks.set(d, i + 1);
  });
  return ranks;
}

/**
 * Where the data file is, by working directory: the repo root (scripts, tests) or apps/web (the Next.js server).
 * Deliberately not `new URL(..., import.meta.url)`: the bundler would then publish the list as a public static asset.
 */
function dataFileCandidates(): string[] {
  const rel = ['packages', 'scanner', 'data', TRANCO.file];
  return [process.env.TRANCO_FILE, join(process.cwd(), ...rel), join(process.cwd(), '..', '..', ...rel)].filter((p): p is string => !!p);
}

let cached: Map<string, number> | null | undefined;

/** The pinned list, loaded once per process. null (and the scan says so) if the file can't be read. */
export function trancoRanks(): Map<string, number> | null {
  if (cached !== undefined) return cached;
  cached = null;
  for (const path of dataFileCandidates()) {
    try {
      if (existsSync(path)) {
        cached = parseRanks(gunzipSync(readFileSync(path)).toString('utf8'));
        break;
      }
    } catch {
      // try the next location
    }
  }
  return cached;
}

export const trancoLookup: RankLookup = (domain) => trancoRanks()?.get(domain.toLowerCase()) ?? null;

export interface Popularity {
  /** Rank in the pinned top list, or null when not in it / not applicable. */
  rank: number | null;
  /** Plain-text evidence line (shown under domain age; no points). */
  evidence: string;
}

/** Rank of the store's own registrable domain. A shop on a shared host never inherits the host's rank. */
export function popularity(domain: DomainInfo, lookup: RankLookup | null): Popularity {
  if (!lookup) return { rank: null, evidence: `Couldn't check the Tranco top-sites list (list ${TRANCO.listId} not available).` };
  if (domain.sharedHosting) {
    return { rank: null, evidence: `This store lives on a shared host (${domain.registrable}); the host's popularity says nothing about the store, so the Tranco top-sites list isn't used.` };
  }
  const d = domain.registrable;
  const rank = d ? lookup(d) : null;
  return rank
    ? { rank, evidence: `Well-known site: ${d} is #${rank.toLocaleString('en-US')} in the Tranco top-sites research list (list ${TRANCO.listId}, ${TRANCO.date}). This alone doesn't make a store safe.` }
    : { rank: null, evidence: `${d ?? domain.hostname} is not in the Tranco top ${TRANCO.top.toLocaleString('en-US')} sites (list ${TRANCO.listId}).` };
}
