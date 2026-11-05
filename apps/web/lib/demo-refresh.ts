import 'server-only';
import { demoResults } from '@voircheck/agent/search';
import { assertSafeUrlShape } from '@voircheck/scanner';
import { freshScansRunning, runStoreScan } from './scan-runner';
import { canonicalUrl, findFreshScan } from './scans';
import { DailyCapError } from './spend';

/**
 * Keeps the demo stores' scans fresh (spec 5.16), so a Demo-mode shopping turn finds them cached (9.9 s on Nov 4)
 * instead of scanning them fresh (13.5 s each, or 77 s when the store was asleep).
 *
 * At most once an hour (kicked off by /api/health, which Render's health check calls), it
 * re-scans each Demo-mode product page whose latest scan is older than 20 hours, one at a time, through the normal
 * runStoreScan path: same KERNEL isolation, same daily KERNEL/AI caps, same limit of scans at once. It never runs
 * while people's scans fill most of the slots, and stops for the day at the KERNEL cap. Production only;
 * DEMO_SCAN_REFRESH=off turns it off.
 *
 * Neon compute: each database check wakes the database for ~5 minutes (its idle suspend), so checking hourly cost
 * ~24 wakes a day. The pass remembers, in memory, when each page's scan turns 20 hours old and asks the database
 * only once one could be (after a restart, once): about 1-2 wakes a day. A scan someone else ran meanwhile is found
 * at that check and moves the due time on.
 */

export const REFRESH_AFTER_MS = 20 * 3_600_000;
export const CHECK_EVERY_MS = 3_600_000;
/** Leave the rest of the app's scan slots (MAX_FRESH_SCANS_RUNNING = 5) to people. */
export const MAX_BUSY_SLOTS = 2;

const DEMO_ITEMS = ['earbuds', 'purifier', 'watch'] as const;

/** The exact URLs Demo-mode shopping scans (pair 1, every item), in the agent's canonical form, so they hit the cache. */
export function demoScanUrls(baseUrl?: string): string[] {
  const urls = DEMO_ITEMS.flatMap((item) => demoResults(item, 1, baseUrl || undefined).map((r) => canonicalUrl(assertSafeUrlShape(r.productUrl).href)));
  return [...new Set(urls)];
}

export interface RefreshDeps {
  latestScanAt(url: string): Promise<Date | null>;
  scan(url: string): Promise<unknown>;
  busySlots(): number;
  now(): number;
  /** When each page's latest known scan turns REFRESH_AFTER_MS old. Before that time the page is skipped unread. */
  dueAt?: Map<string, number>;
}

const g = globalThis as typeof globalThis & { __voircheckDemoRefresh?: { lastCheck: number; running: boolean }; __voircheckDemoDueAt?: Map<string, number> };

const liveDeps: RefreshDeps = {
  latestScanAt: async (url) => (await findFreshScan(url))?.scannedAt ?? null,
  scan: (url) => runStoreScan({ url, demoMode: true, liveView: false }),
  busySlots: freshScansRunning,
  now: Date.now,
  get dueAt() {
    return (g.__voircheckDemoDueAt ??= new Map());
  },
};

/** One pass: re-scan the stale demo pages, one at a time. Returns what it re-scanned. */
export async function refreshDemoScans(urls: string[], deps: RefreshDeps = liveDeps): Promise<string[]> {
  const done: string[] = [];
  for (const url of urls) {
    if ((deps.dueAt?.get(url) ?? 0) > deps.now()) continue; // known fresh: no database query
    const last = await deps.latestScanAt(url);
    if (last && deps.now() - last.getTime() < REFRESH_AFTER_MS) {
      deps.dueAt?.set(url, last.getTime() + REFRESH_AFTER_MS);
      continue;
    }
    if (deps.busySlots() >= MAX_BUSY_SLOTS) break;
    try {
      await deps.scan(url);
      deps.dueAt?.set(url, deps.now() + REFRESH_AFTER_MS);
      done.push(url);
    } catch (err) {
      if (err instanceof DailyCapError) break; // today's KERNEL cap: people's scans come first; try again tomorrow
      console.error('demo scan refresh failed:', err instanceof Error ? err.message : 'unknown error');
    }
  }
  return done;
}

export function demoRefreshEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'production' && !!env.KERNEL_API_KEY && env.DEMO_SCAN_REFRESH !== 'off';
}

/** Fire-and-forget: starts a pass when enabled, none is running, and the last one began over an hour ago. */
export function maybeRefreshDemoScans(now = Date.now(), env: Record<string, string | undefined> = process.env, run: (urls: string[]) => Promise<unknown> = refreshDemoScans): boolean {
  if (!demoRefreshEnabled(env)) return false;
  const state = (g.__voircheckDemoRefresh ??= { lastCheck: 0, running: false });
  if (state.running || now - state.lastCheck < CHECK_EVERY_MS) return false;
  state.lastCheck = now;
  state.running = true;
  void run(demoScanUrls(env.DEMO_STORES_BASE_URL))
    .catch((err) => console.error('demo scan refresh failed:', err instanceof Error ? err.message : 'unknown error'))
    .finally(() => {
      state.running = false;
    });
  return true;
}
