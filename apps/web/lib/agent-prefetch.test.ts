import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const runStoreScan = vi.fn();
const checkScanLimits = vi.fn();
vi.mock('./scan-runner', () => ({ runStoreScan: (...a: unknown[]) => runStoreScan(...a), ScanBusyError: class ScanBusyError extends Error {} }));
vi.mock('./rate-limit', () => ({ checkScanLimits: (...a: unknown[]) => checkScanLimits(...a) }));
vi.mock('./scans', () => ({
  canonicalUrl: (u: string) => u,
  findFreshScan: async () => null,
  recordSearchRequest: async (o: { stores: unknown[] }) => ({ candidateIds: o.stores.map((_, i) => `cand-${i}`) }),
}));
vi.mock('./scan-view', () => ({ toScanView: (row: { id: string }) => ({ id: row.id, verdict: 'SAFE', score: 0, signals: [], hardRules: [] }) }));
vi.mock('./orders', () => ({ refundableRefsAtStore: async () => [] }));
vi.mock('./spend', () => ({ anthropicCapReached: async () => false, recordSpendQuietly: async () => undefined, DailyCapError: class DailyCapError extends Error {} }));
vi.mock('./paypal', () => ({ getPayPal: () => ({ store: {}, gate: {} }) }));
vi.mock('@voircheck/agent', async (orig) => ({
  ...(await orig<typeof import('@voircheck/agent')>()),
  compareStores: async () => ({
    status: 'ok',
    sameProduct: true,
    stores: ['a', 'b', 'c'].map((x) => ({ source: 'channel3', storeName: `Store ${x}`, storeUrl: `https://${x}.example/`, productUrl: `https://${x}.example/p`, title: 'Buds', price: 50, currency: 'usd' })),
  }),
}));

const { openConversation, webDeps } = await import('./agent-runtime');

function setup() {
  const { id, conv } = openConversation('user-1', null);
  const events: { type: string; storeId?: string }[] = [];
  const deps = webDeps({ convId: id, conv, userId: 'user-1', isGuest: false, ip: '1.2.3.4', demoMode: false, origin: 'http://x', send: (e) => events.push(e as never) });
  return { deps, events };
}

describe('scans start as soon as search returns', () => {
  beforeEach(() => {
    runStoreScan.mockReset().mockImplementation(async (o: { url: string }) => ({ id: `scan-${o.url}`, url: o.url }));
    checkScanLimits.mockReset().mockResolvedValue({ ok: true });
  });

  it('each store found is scanned once, and get_scan_verdict reuses that scan', async () => {
    const { deps, events } = setup();
    const found = await deps.searchStores('earbuds', 60);
    expect(found.status).toBe('ok');
    // Started right away, before the model asks.
    expect(events.filter((e) => e.type === 'scan_start').map((e) => e.storeId)).toEqual(['cand-0', 'cand-1', 'cand-2']);
    const verdicts = await Promise.all(['cand-0', 'cand-1', 'cand-2'].map((id) => deps.scanStore(id)));
    expect(verdicts.every((v) => v.status === 'ok')).toBe(true);
    expect(runStoreScan).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.type === 'scan_done')).toHaveLength(3);
    expect(checkScanLimits).toHaveBeenCalledTimes(3); // the person's limits still apply, once per store
  });

  it('a prefetch that hit the limit is tried again when the model asks', async () => {
    const { deps } = setup();
    checkScanLimits.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    await deps.searchStores('earbuds', 60);
    await new Promise((r) => setTimeout(r, 0));
    const results = await Promise.all(['cand-0', 'cand-1', 'cand-2'].map((id) => deps.scanStore(id)));
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(runStoreScan).toHaveBeenCalledTimes(3);
  });

  it('a store the search never returned is still unknown', async () => {
    const { deps } = setup();
    expect(await deps.scanStore('cand-9')).toEqual({ status: 'unavailable', reason: 'unknown_store' });
    expect(runStoreScan).not.toHaveBeenCalled();
  });
});
