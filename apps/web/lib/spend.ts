import 'server-only';
import { dailySpend } from '@voircheck/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getDb } from './db';

/**
 * Global daily caps for the public demo (spec 5.17 #3), across all users, per UTC day. Per-user and per-IP limits
 * can be dodged with throwaway guest accounts; these can't. Anthropic stays under the $5 workspace cap, so hitting it
 * here is a calm "back tomorrow", not an out-of-credit error. Past the Anthropic cap, scans still run with page
 * analysis "unavailable"; past the KERNEL cap, only cached scans (last 24h) are served.
 */
export const DAILY_CAPS = { anthropicUsd: 3, kernelScans: 300 } as const;

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export interface SpendToday {
  anthropicUsd: number;
  kernelScans: number;
}

export async function spendToday(now = new Date()): Promise<SpendToday> {
  const [row] = await getDb().select().from(dailySpend).where(eq(dailySpend.day, utcDay(now))).limit(1);
  return { anthropicUsd: Number(row?.anthropicUsd ?? 0), kernelScans: row?.kernelScans ?? 0 };
}

export const anthropicCapReached = async () => (await spendToday()).anthropicUsd >= DAILY_CAPS.anthropicUsd;
export const kernelCapReached = async () => (await spendToday()).kernelScans >= DAILY_CAPS.kernelScans;

/** Adds to today's row atomically (one upsert, safe with concurrent requests). */
export async function recordSpend(add: { anthropicUsd?: number; kernelScans?: number }, now = new Date()): Promise<void> {
  const usd = (add.anthropicUsd ?? 0).toFixed(6);
  const scans = add.kernelScans ?? 0;
  if (Number(usd) === 0 && scans === 0) return;
  await getDb()
    .insert(dailySpend)
    // A settlement can be negative (a reservation handed back); it never takes the day below zero.
    .values({ day: utcDay(now), anthropicUsd: Math.max(0, Number(usd)).toFixed(6), kernelScans: Math.max(0, scans) })
    .onConflictDoUpdate({
      target: dailySpend.day,
      set: { anthropicUsd: sql`GREATEST(${dailySpend.anthropicUsd} + ${usd}, 0)`, kernelScans: sql`GREATEST(${dailySpend.kernelScans} + ${scans}, 0)` },
    });
}

/**
 * Up-front reservations for a fresh scan (security review, H1). Checking the cap and recording the spend after the
 * scan let every scan already running pass the check, so concurrent scans overshot the cap. Each reservation is one
 * statement (INSERT … ON CONFLICT DO UPDATE … WHERE below the cap RETURNING): Postgres serialises it per day row, so
 * no more than the cap is ever reserved. No row back → the cap is reached.
 */
type Db = ReturnType<typeof getDb>;

/** Upper bound for one scan's page analysis (typically $0.02–0.04). Settled to the real cost when the scan ends. */
export const AI_RESERVE_PER_SCAN_USD = 0.05;

export const reserveKernelQuery = (db: Db, day: string) =>
  db
    .insert(dailySpend)
    .values({ day, kernelScans: 1 })
    .onConflictDoUpdate({
      target: dailySpend.day,
      set: { kernelScans: sql`${dailySpend.kernelScans} + 1` },
      setWhere: sql`${dailySpend.kernelScans} < ${DAILY_CAPS.kernelScans}`,
    })
    .returning({ day: dailySpend.day });

export const reserveAiQuery = (db: Db, day: string, usd: number) =>
  db
    .insert(dailySpend)
    .values({ day, anthropicUsd: usd.toFixed(6) })
    .onConflictDoUpdate({
      target: dailySpend.day,
      set: { anthropicUsd: sql`${dailySpend.anthropicUsd} + ${usd.toFixed(6)}` },
      setWhere: sql`${dailySpend.anthropicUsd} < ${DAILY_CAPS.anthropicUsd.toFixed(6)}`,
    })
    .returning({ day: dailySpend.day });

/** One KERNEL session for a fresh scan. false: today's KERNEL cap is reached. */
export async function reserveKernelScan(now = new Date()): Promise<boolean> {
  return (await reserveKernelQuery(getDb(), utcDay(now))).length > 0;
}

/** One scan's page analysis. false: today's Anthropic cap is reached (the scan runs without page analysis). */
export async function reserveAiScan(now = new Date()): Promise<boolean> {
  return (await reserveAiQuery(getDb(), utcDay(now), AI_RESERVE_PER_SCAN_USD)).length > 0;
}

/** Never lets bookkeeping break a scan or a chat turn. */
export function recordSpendQuietly(add: { anthropicUsd?: number; kernelScans?: number }): Promise<void> {
  return recordSpend(add).catch((err) => console.error('[spend] could not record:', err instanceof Error ? err.message : 'unknown error'));
}

export class DailyCapError extends Error {
  constructor() {
    super('daily spend cap reached');
    this.name = 'DailyCapError';
  }
}
