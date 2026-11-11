import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const dbState = { fail: true, rows: new Map<string, { value: unknown; expiresAt: Date }>() };
vi.mock('./db', () => ({
  getDb: () => {
    if (dbState.fail) throw new Error('relation "ai_page_cache" does not exist');
    return {};
  },
}));

const { cacheExpiry, CACHE_HOURS, DEMO_CACHE_EXPIRES, isDemoStoreUrl } = await import('./scans');
const { dbAiCache } = await import('./ai-cache');

describe('cache times (J, Nov 11)', () => {
  it('scans are reused for 72 hours', () => {
    const at = new Date('2026-11-11T00:00:00Z');
    expect(CACHE_HOURS).toBe(72);
    expect(cacheExpiry('https://shop.example/products/x', at).toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });
  it('our demo stores (and lab pages on their host) are cached permanently', () => {
    const at = new Date('2026-11-11T00:00:00Z');
    expect(isDemoStoreUrl('https://voircheck-stores.onrender.com/velbrook/products/zephlet-buds')).toBe(true);
    expect(cacheExpiry('https://voircheck-stores.onrender.com/velbrook', at)).toEqual(DEMO_CACHE_EXPIRES);
    expect(isDemoStoreUrl('https://voircheck-stores.onrender.com.evil.example/')).toBe(false);
    expect(isDemoStoreUrl('not a url')).toBe(false);
  });
});

describe('AI page-analysis cache in the database', () => {
  it('until the table exists (or the database fails) it falls back to memory, and a scan never breaks', async () => {
    dbState.fail = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = dbAiCache();
    const value = { findings: [], risk: 10, product: null, summary: { en: 'Fine.', fr: 'Bien.' }, by: { provider: 'groq' as const, model: 'qwen/qwen3.8-27b' } };
    await cache.set('k', value as never, 60_000);
    expect(await cache.get('k')).toEqual(value);
    expect(spy).toHaveBeenCalledTimes(1); // said once, not on every call
    spy.mockRestore();
  });
});
