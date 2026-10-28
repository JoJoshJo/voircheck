import 'server-only';
import { scans, shoppingSessions } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { and, count, eq, gt } from 'drizzle-orm';
import { getDb } from './db';

/**
 * Rate limits (spec 5.17 #3): guests 5 agent requests + 15 store scans per hour; signed-in users double that;
 * per-IP limits; global cap 500 fresh scans per day to protect KERNEL credits.
 * Per-user and global counts come from the database (they survive restarts and work across instances).
 * Per-IP counts are in memory (single Render instance; resets on deploy, which is fine for abuse control).
 */
export const LIMITS = {
  guest: { agentRequestsPerHour: 5, scansPerHour: 15 },
  user: { agentRequestsPerHour: 10, scansPerHour: 30 },
  scansPerIpPerHour: 30,
  globalScansPerDay: 500,
  demoAccountsPerIpPerHour: 5,
} as const;

const HOUR = 3_600_000;
const windows = new Map<string, number[]>();

/** Sliding one-hour window in memory; records the hit when allowed. */
export function hitWindow(key: string, max: number, now = Date.now()): boolean {
  const recent = (windows.get(key) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= max) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  return true;
}

export const allowDemoCreation = (ip: string) => hitWindow(`demo:${ip}`, LIMITS.demoAccountsPerIpPerHour);

export type ScanLimitResult = { ok: true } | { ok: false; reason: 'user' | 'ip' | 'global' };

/** Call before recording the new request. `fresh` = a KERNEL scan will run (cache miss). */
export async function checkScanLimits(opts: { userId: string; isGuest: boolean; ip: string; fresh: boolean }): Promise<ScanLimitResult> {
  const db = getDb();
  const since = new Date(Date.now() - HOUR);
  const [mine] = await db
    .select({ n: count() })
    .from(shoppingSessions)
    .where(ownedBy(shoppingSessions, opts.userId, eq(shoppingSessions.entryType, 'link'), gt(shoppingSessions.createdAt, since)));
  const perUser = opts.isGuest ? LIMITS.guest.scansPerHour : LIMITS.user.scansPerHour;
  if ((mine?.n ?? 0) >= perUser) return { ok: false, reason: 'user' };
  if (opts.fresh) {
    const [today] = await db.select({ n: count() }).from(scans).where(and(gt(scans.scannedAt, new Date(Date.now() - 24 * HOUR))));
    if ((today?.n ?? 0) >= LIMITS.globalScansPerDay) return { ok: false, reason: 'global' };
  }
  if (!hitWindow(`scan:${opts.ip}`, LIMITS.scansPerIpPerHour)) return { ok: false, reason: 'ip' };
  return { ok: true };
}

/** For the agent route (arrives with the Anthropic key). */
export function allowAgentRequest(userId: string, isGuest: boolean): boolean {
  return hitWindow(`agent:${userId}`, isGuest ? LIMITS.guest.agentRequestsPerHour : LIMITS.user.agentRequestsPerHour);
}
