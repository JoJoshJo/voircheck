import 'server-only';
import { candidates, scans, shoppingSessions } from '@voircheck/db/schema';
import type { ScanResult } from '@voircheck/scanner';
import { ownedBy } from '@voircheck/shared';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb } from './db';

export const CACHE_HOURS = 24;

/** Canonical form for cache lookups: no fragment, lowercase host. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
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
      explanation: {},
      hardRulesTriggered: result.hardRulesTriggered,
      kernelReplayUrl: withoutQuery(result.kernel.replayUrl),
      scannedAt,
      cacheExpiresAt: new Date(scannedAt.getTime() + CACHE_HOURS * 3_600_000),
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

export async function finishLinkRequest(userId: string, sessionId: string, status: 'done' | 'failed') {
  await getDb().update(shoppingSessions).set({ status }).where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.id, sessionId)));
}

/** A scan is visible to a user who asked for that URL (scans are a shared cache, sessions are private). */
export async function getScanForUser(scanId: string, userId: string): Promise<ScanRecord | null> {
  const db = getDb();
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) return null;
  const [mine] = await db
    .select({ id: shoppingSessions.id })
    .from(shoppingSessions)
    .where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.queryOrUrl, scan.url)))
    .limit(1);
  return mine ? scan : null;
}
