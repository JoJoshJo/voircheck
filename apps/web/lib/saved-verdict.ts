import 'server-only';
import { scans } from '@voircheck/db/schema';
import { DEFAULT_DEMO_STORES_BASE_URL } from '@voircheck/agent/search';
import { and, desc, gt, inArray } from 'drizzle-orm';
import { getDb } from './db';

/**
 * The Chrome extension's quick look (spec 5.23, Nov 11): the latest SAVED verdict for a store domain. No scan, no AI
 * call, no sign-in. It answers only the verdict, a hedged line and when it was checked: never a URL, a score, the
 * evidence, or anything about who asked for the scan or what they bought.
 */
export const SAVED_VERDICT_HOURS = 72;
export const SAVED_VERDICT_READS_PER_IP_PER_HOUR = 60;

export type SavedVerdict =
  | { status: 'checked'; verdict: 'SAFE' | 'HOLD' | 'BLOCK'; message: { en: string; fr: string }; checkedAt: string }
  | { status: 'not_checked' };

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/** "Shop.Example." / "www.shop.example" → "shop.example"; anything that isn't a plain host name → null. */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return HOST_RE.test(host) ? host : null;
}

/**
 * Our demo stores all share one host (/s/<slug>/…), safe and fake ones side by side, so one answer for the domain
 * would mix them up: it always says "Not checked yet".
 */
export function isSharedDemoHost(domain: string, base = process.env.DEMO_STORES_BASE_URL || DEFAULT_DEMO_STORES_BASE_URL): boolean {
  try {
    return normalizeDomain(new URL(base).hostname) === domain;
  } catch {
    return false;
  }
}

/** Hedged on purpose: it's what we saw then, not a promise about now. */
export const SAVED_MESSAGES = {
  SAFE: {
    en: 'It looked safe when VoirCheck checked it. Things can change: check again before you pay.',
    fr: 'Elle semblait fiable lors de notre vérification. Les choses changent : vérifiez à nouveau avant de payer.',
  },
  HOLD: {
    en: 'Something looked a bit off when VoirCheck checked it. See why before you pay.',
    fr: 'Un doute lors de notre vérification. Regardez pourquoi avant de payer.',
  },
  BLOCK: {
    en: 'It looked like a fake shop when VoirCheck checked it. Don’t pay without seeing why.',
    fr: 'Elle semblait fausse lors de notre vérification. Ne payez pas sans voir pourquoi.',
  },
} as const;

export function toSavedVerdict(row: { verdict: 'SAFE' | 'HOLD' | 'BLOCK'; scannedAt: Date } | null | undefined): SavedVerdict {
  if (!row) return { status: 'not_checked' };
  return { status: 'checked', verdict: row.verdict, message: SAVED_MESSAGES[row.verdict], checkedAt: row.scannedAt.toISOString() };
}

/** The newest scan of this domain (with or without www.) from the last 72 hours. Reads two columns only. */
export async function savedVerdictFor(domain: string, now = new Date()): Promise<SavedVerdict> {
  if (isSharedDemoHost(domain)) return { status: 'not_checked' };
  const since = new Date(now.getTime() - SAVED_VERDICT_HOURS * 3_600_000);
  const [row] = await getDb()
    .select({ verdict: scans.verdict, scannedAt: scans.scannedAt })
    .from(scans)
    .where(and(inArray(scans.storeDomain, [domain, `www.${domain}`]), gt(scans.scannedAt, since)))
    .orderBy(desc(scans.scannedAt))
    .limit(1);
  return toSavedVerdict(row);
}
