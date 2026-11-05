import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./scan-runner', () => ({ freshScansRunning: () => 0, runStoreScan: vi.fn() }));
vi.mock('./scans', () => ({ canonicalUrl: (u: string) => u, findFreshScan: vi.fn() }));
vi.mock('./spend', () => ({ DailyCapError: class DailyCapError extends Error {} }));

const { CHECK_EVERY_MS, demoRefreshEnabled, demoScanUrls, maybeRefreshDemoScans, REFRESH_AFTER_MS, refreshDemoScans } = await import('./demo-refresh');
const { DailyCapError } = await import('./spend');

const NOW = Date.UTC(2026, 10, 4, 12);
const deps = (ages: Record<string, number | null>, over: Partial<Parameters<typeof refreshDemoScans>[1] & object> = {}) => {
  const scanned: string[] = [];
  return {
    scanned,
    d: {
      latestScanAt: async (u: string) => (ages[u] == null ? null : new Date(NOW - ages[u]!)),
      scan: async (u: string) => void scanned.push(u),
      busySlots: () => 0,
      now: () => NOW,
      ...over,
    },
  };
};

describe('demo scan refresh', () => {
  it('covers every Demo-mode product page: 3 items at the legit and the scam store', () => {
    const urls = demoScanUrls('https://stores.example');
    expect(urls).toHaveLength(6);
    for (const u of urls) expect(u).toMatch(/^https:\/\/stores\.example\/s\/[a-z-]+\/products\/[a-z0-9-]+$/);
  });

  it('re-scans only pages whose latest scan is over 20 hours old (or missing), one at a time', async () => {
    const { scanned, d } = deps({ a: REFRESH_AFTER_MS - 60_000, b: REFRESH_AFTER_MS + 60_000, c: null });
    expect(await refreshDemoScans(['a', 'b', 'c'], d)).toEqual(['b', 'c']);
    expect(scanned).toEqual(['b', 'c']);
  });

  it('remembers when each scan turns 20 h old and asks the database only then', async () => {
    let t = NOW;
    const reads: string[] = [];
    const scanned: string[] = [];
    const dueAt = new Map<string, number>();
    const d = {
      latestScanAt: async (u: string) => (reads.push(u), u === 'a' ? new Date(NOW - 60 * 60_000) : null), // a: 1 h old; b: never scanned
      scan: async (u: string) => void scanned.push(u),
      busySlots: () => 0,
      now: () => t,
      dueAt,
    };
    expect(await refreshDemoScans(['a', 'b'], d)).toEqual(['b']);
    expect(reads).toEqual(['a', 'b']);
    // The next hourly passes read nothing while both are known fresh.
    for (let h = 1; h < 19; h++) {
      t = NOW + h * CHECK_EVERY_MS;
      expect(await refreshDemoScans(['a', 'b'], d)).toEqual([]);
    }
    expect(reads).toEqual(['a', 'b']);
    // a turns 20 h old at NOW + 19 h: only a is read (and here re-scanned).
    t = NOW + 19 * CHECK_EVERY_MS;
    d.latestScanAt = async (u: string) => (reads.push(u), new Date(NOW - 60 * 60_000));
    expect(await refreshDemoScans(['a', 'b'], d)).toEqual(['a']);
    expect(reads).toEqual(['a', 'b', 'a']);
    expect(dueAt.get('a')).toBe(t + REFRESH_AFTER_MS);
  });

  it('a newer scan found at the due check moves the due time on, without re-scanning', async () => {
    const dueAt = new Map([['a', NOW - 1]]);
    const { scanned, d } = deps({ a: 2 * 3_600_000 }, { dueAt });
    expect(await refreshDemoScans(['a'], d)).toEqual([]);
    expect(scanned).toEqual([]);
    expect(dueAt.get('a')).toBe(NOW - 2 * 3_600_000 + REFRESH_AFTER_MS);
  });

  it('a failed or skipped scan stays due, so the next pass tries again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dueAt = new Map<string, number>();
    const failed = deps({ a: null }, { dueAt, scan: async () => { throw new Error('boom'); } });
    await refreshDemoScans(['a'], failed.d);
    const busy = deps({ b: null }, { dueAt, busySlots: () => 2 });
    await refreshDemoScans(['b'], busy.d);
    expect(dueAt.size).toBe(0);
    errors.mockRestore();
  });

  it('leaves the scan slots to people when two are busy, and stops at the daily KERNEL cap', async () => {
    const busy = deps({ a: null, b: null }, { busySlots: () => 2 });
    expect(await refreshDemoScans(['a', 'b'], busy.d)).toEqual([]);
    let calls = 0;
    const cap = deps({ a: null, b: null }, { scan: async () => { calls++; throw new DailyCapError(); } });
    expect(await refreshDemoScans(['a', 'b'], cap.d)).toEqual([]);
    expect(calls).toBe(1);
  });

  it('one failed page does not stop the others', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { d } = deps({ a: null, b: null }, { scan: async (u: string) => { if (u === 'a') throw new Error('boom'); } });
    expect(await refreshDemoScans(['a', 'b'], d)).toEqual(['b']);
    errors.mockRestore();
  });

  it('production only, needs a KERNEL key, DEMO_SCAN_REFRESH=off turns it off', () => {
    expect(demoRefreshEnabled({ NODE_ENV: 'production', KERNEL_API_KEY: 'k' })).toBe(true);
    expect(demoRefreshEnabled({ NODE_ENV: 'development', KERNEL_API_KEY: 'k' })).toBe(false);
    expect(demoRefreshEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(demoRefreshEnabled({ NODE_ENV: 'production', KERNEL_API_KEY: 'k', DEMO_SCAN_REFRESH: 'off' })).toBe(false);
  });

  it('starts at most one pass an hour, never two at once', async () => {
    const env = { NODE_ENV: 'production', KERNEL_API_KEY: 'k' };
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    expect(maybeRefreshDemoScans(NOW, env, run)).toBe(true);
    expect(maybeRefreshDemoScans(NOW + CHECK_EVERY_MS + 1, env, run)).toBe(false); // still running
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(maybeRefreshDemoScans(NOW + 60_000, env, run)).toBe(false); // within the hour
    expect(maybeRefreshDemoScans(NOW + CHECK_EVERY_MS + 1, env, run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maybeRefreshDemoScans(NOW * 2, { NODE_ENV: 'development' }, run)).toBe(false);
  });
});
