import 'server-only';
import { candidates, scans, shoppingSessions } from '@voircheck/db/schema';
import { scanCoversStore } from '@voircheck/paypal';
import { stripTracking, type ScanResult } from '@voircheck/scanner';
import { DEFAULT_DEMO_STORES_BASE_URL } from '@voircheck/agent/search';
import { ownedBy } from '@voircheck/shared';
import { and, desc, eq, gt, like, or } from 'drizzle-orm';
import { getDb } from './db';

/** How long a scan is reused (J, Nov 11: 72 h, was 24 h). Demo stores: permanent (see `cacheExpiry`). */
export const CACHE_HOURS = 72;
/** "Permanent" for demo stores: our own fictional shops, whose pages only change when we deploy them. */
export const DEMO_CACHE_EXPIRES = new Date('9999-12-31T00:00:00Z');

/** Is this URL one of our own demo stores (or a lab page on the same host)? */
export function isDemoStoreUrl(url: string, base = process.env.DEMO_STORES_BASE_URL || DEFAULT_DEMO_STORES_BASE_URL): boolean {
  try {
    return new URL(url).hostname === new URL(base).hostname;
  } catch {
    return false;
  }
}

/** When a scan stops being reused: 72 h, or never for a demo store. */
export const cacheExpiry = (url: string, scannedAt: Date) => (isDemoStoreUrl(url) ? DEMO_CACHE_EXPIRES : new Date(scannedAt.getTime() + CACHE_HOURS * 3_600_000));

/** Canonical form for cache lookups and storage: no fragment, lowercase host, no ad/click tracking (gclid, utm_*, ...). */
export function canonicalUrl(raw: string): string {
  const u = new URL(stripTracking(new URL(raw.trim()).href));
  u.hash = '';
  return u.href;
}

export type ScanRecord = typeof scans.$inferSelect;

export async function findFreshScan(url: string): Promise<ScanRecord | null> {
  const [row] = await getDb()
    .select()
    .from(scans)
    .where(and(eq(scans.url, url), gt(scans.cacheExpiresAt, new Date())))
    .orderBy(desc(scans.scannedAt))
    .limit(1);
  return row ?? null;
}

/**
 * A store's own latest verdict (any age), from scans of its URL or any page under it. The scanner uses it to leave
 * BLOCK stores out of other stores' price comparison. Unscanned stores have no verdict (undefined).
 */
export async function latestVerdictForStore(storeUrl: string): Promise<'SAFE' | 'HOLD' | 'BLOCK' | undefined> {
  const base = storeUrl.replace(/\/$/, '');
  const prefix = `${base.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
  const [row] = await getDb()
    .select({ verdict: scans.verdict })
    .from(scans)
    .where(or(eq(scans.url, base), eq(scans.url, `${base}/`), like(scans.url, prefix)))
    .orderBy(desc(scans.scannedAt))
    .limit(1);
  return row?.verdict;
}

/** Replay links can carry a session token in the query; only the bare link is stored. Live-view links are never stored. */
const withoutQuery = (u: string | undefined) => (u ? u.split('?')[0]! : null);

export async function saveScan(result: ScanResult): Promise<ScanRecord> {
  const scannedAt = new Date(result.scannedAt);
  const [row] = await getDb()
    .insert(scans)
    .values({
      storeDomain: result.domain,
      url: result.url,
      riskScore: result.score,
      verdict: result.verdict,
      signals: result.signals,
      // The research step's "what the web says" (evidence only); scans before Nov 7 have {}.
      explanation: result.webReputation ? { webReputation: result.webReputation } : {},
      hardRulesTriggered: result.hardRulesTriggered,
      kernelReplayUrl: withoutQuery(result.kernel.replayUrl),
      scannedAt,
      cacheExpiresAt: cacheExpiry(result.url, scannedAt),
    })
    .returning();
  return row!;
}

/**
 * Every check-a-link request: a shopping session + its candidate. A pasted real link has no known price (null, never
 * chargeable); a demo store's price comes from our own config.
 */
export async function recordLinkRequest(opts: {
  userId: string;
  url: string;
  demoMode: boolean;
  storeName: string;
  storeUrl: string;
  productTitle: string;
  price: string | null;
  source: 'demo' | 'link';
}): Promise<{ sessionId: string; candidateId: string }> {
  const db = getDb();
  const [session] = await db
    .insert(shoppingSessions)
    .values({ userId: opts.userId, entryType: 'link', queryOrUrl: opts.url, demoMode: opts.demoMode, status: 'scanning' })
    .returning({ id: shoppingSessions.id });
  const [candidate] = await db
    .insert(candidates)
    .values({ sessionId: session!.id, storeName: opts.storeName, storeUrl: opts.storeUrl, productTitle: opts.productTitle, price: opts.price, currency: 'USD', source: opts.source, rank: 1 })
    .returning({ id: candidates.id });
  return { sessionId: session!.id, candidateId: candidate!.id };
}

/**
 * A shopping-agent search: a chat session + one candidate per store, in rank order. Prices come from Channel3 or our
 * demo config, never from the model.
 */
export async function recordSearchRequest(opts: {
  userId: string;
  query: string;
  demoMode: boolean;
  stores: Array<{ storeName: string; storeUrl: string; productTitle: string; price: string | null; currency: string; source: 'demo' | 'channel3' }>;
}): Promise<{ sessionId: string; candidateIds: string[] }> {
  const db = getDb();
  const [session] = await db
    .insert(shoppingSessions)
    .values({ userId: opts.userId, entryType: 'chat', queryOrUrl: opts.query, demoMode: opts.demoMode, status: 'done' })
    .returning({ id: shoppingSessions.id });
  const rows = opts.stores.length
    ? await db
        .insert(candidates)
        .values(opts.stores.map((st, i) => ({ sessionId: session!.id, ...st, rank: i + 1 })))
        .returning({ id: candidates.id, rank: candidates.rank })
    : [];
  return { sessionId: session!.id, candidateIds: rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).map((r) => r.id) };
}

export async function finishLinkRequest(userId: string, sessionId: string, status: 'done' | 'failed') {
  await getDb().update(shoppingSessions).set({ status }).where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.id, sessionId)));
}

/**
 * A scan is visible to a user who asked for that URL, or whose shopping agent found that store (scans are a shared
 * cache, sessions are private).
 */
export async function getScanForUser(scanId: string, userId: string): Promise<ScanRecord | null> {
  const db = getDb();
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) return null;
  const [mine] = await db
    .select({ id: shoppingSessions.id })
    .from(shoppingSessions)
    .where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.queryOrUrl, scan.url)))
    .limit(1);
  if (mine) return scan;
  const found = await db
    .select({ storeUrl: candidates.storeUrl })
    .from(candidates)
    .innerJoin(shoppingSessions, eq(candidates.sessionId, shoppingSessions.id))
    .where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.entryType, 'chat')))
    .orderBy(desc(shoppingSessions.createdAt))
    .limit(60);
  return found.some((c) => scanCoversStore(scan.url, c.storeUrl)) ? scan : null;
}
