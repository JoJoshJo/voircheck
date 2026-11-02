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
    .values({ day: utcDay(now), anthropicUsd: usd, kernelScans: scans })
    .onConflictDoUpdate({
      target: dailySpend.day,
      set: { anthropicUsd: sql`${dailySpend.anthropicUsd} + ${usd}`, kernelScans: sql`${dailySpend.kernelScans} + ${scans}` },
    });
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
