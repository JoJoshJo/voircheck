import { beforeEach, describe, expect, it, vi } from 'vitest';

// check_link in the web app: the same guards as "Check a store link", check-only, shown as a store card.
vi.mock('server-only', () => ({}));
vi.mock('./orders', () => ({}));
const limits = vi.fn<(o: unknown) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true }));
vi.mock('./rate-limit', () => ({ checkScanLimits: (o: unknown) => limits(o) }));
const runStoreScan = vi.fn<(o: unknown) => Promise<{ id: string }>>(async () => ({ id: 'scan-new' }));
vi.mock('./scan-runner', () => ({ runStoreScan: (o: unknown) => runStoreScan(o), ScanBusyError: class extends Error {} }));
const fresh = vi.fn<(u: string) => Promise<null | { id: string }>>(async () => null);
const finished: string[] = [];
const recorded: unknown[] = [];
vi.mock('./scans', () => ({
  canonicalUrl: (u: string) => u,
  findFreshScan: (u: string) => fresh(u),
  recordLinkRequest: async (o: unknown) => (recorded.push(o), { sessionId: 'sess-1', candidateId: 'cand-link' }),
  finishLinkRequest: async (_u: string, _s: string, st: string) => void finished.push(st),
  recordSearchRequest: async () => ({ candidateIds: [] }),
}));
vi.mock('./scan-view', () => ({ toScanView: (r: { id: string }) => ({ id: r.id, verdict: 'BLOCK', score: 90, signals: [], hardRules: [] }) }));
vi.mock('./spend', () => ({ anthropicCapReached: async () => false, recordSpendQuietly: async () => undefined, DailyCapError: class extends Error {} }));
vi.mock('./paypal', () => ({ getPayPal: () => ({ store: {}, gate: { agentStartPurchase: vi.fn() } }) }));

async function setup() {
  const { openConversation, webDeps } = await import('./agent-runtime');
  const { id, conv } = openConversation('user-1', null);
  const events: Array<{ type: string } & Record<string, unknown>> = [];
  const deps = webDeps({ convId: id, conv, userId: 'user-1', isGuest: true, ip: '127.0.0.1', demoMode: true, origin: 'http://localhost:3000', send: (e) => events.push(e as never) });
  return { conv, deps, events };
}

const DEMO_LINK = 'https://voircheck-stores.onrender.com/s/velbrook-outlet-deals/products/zephlet-buds';

describe('check_link in the web app', () => {
  beforeEach(() => {
    limits.mockClear();
    runStoreScan.mockClear();
    fresh.mockReset().mockResolvedValue(null);
    finished.length = 0;
    recorded.length = 0;
  });

  it('refuses unsafe or invalid links before anything is recorded or scanned (SSRF guard)', async () => {
    const { deps, events } = await setup();
    for (const url of ['http://127.0.0.1/admin', 'https://localhost/', 'file:///etc/passwd', 'https://10.0.0.1/', 'not a link']) {
      expect(await deps.checkLink(url)).toEqual({ status: 'unavailable', reason: 'invalid_url' });
    }
    expect(recorded).toEqual([]);
    expect(runStoreScan).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('a fresh link: the person’s scan limits, then runStoreScan; a card with no price; never buyable', async () => {
    const { conv, deps, events } = await setup();
    const r = await deps.checkLink(DEMO_LINK);
    expect(limits).toHaveBeenCalledWith({ userId: 'user-1', isGuest: true, ip: '127.0.0.1', fresh: true });
    expect(runStoreScan).toHaveBeenCalledWith(expect.objectContaining({ url: DEMO_LINK, demoMode: true, liveView: false }));
    expect(r).toMatchObject({ status: 'ok', storeId: 'cand-link', scanId: 'scan-new', site: 'voircheck-stores.onrender.com', verdict: 'BLOCK' });
    expect(recorded[0]).toMatchObject({ userId: 'user-1', url: DEMO_LINK, price: null, source: 'demo', storeName: 'Velbrook-Outlet Deals' });
    expect(finished).toEqual(['done']);
    expect(events.map((e) => e.type)).toEqual(['stores', 'scan_start', 'scan_done']);
    expect(events[0]).toMatchObject({ stores: [{ storeId: 'cand-link', price: null, demo: true }] });
    // Check-only: create_order doesn't know a pasted link's store.
    expect(conv.stores.has('cand-link')).toBe(false);
    expect(await deps.createOrder('cand-link')).toEqual({ storeId: 'cand-link', status: 'refused', reason: 'not_found' });
  });

  it('a cached scan is reused without a new scan', async () => {
    fresh.mockResolvedValue({ id: 'scan-cached' });
    const { deps, events } = await setup();
    expect(await deps.checkLink('https://shop.example.com/')).toMatchObject({ status: 'ok', scanId: 'scan-cached', site: 'shop.example.com' });
    expect(limits).toHaveBeenCalledWith(expect.objectContaining({ fresh: false }));
    expect(runStoreScan).not.toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({ source: 'link', price: null });
    expect(events.at(-1)).toMatchObject({ type: 'scan_done', cached: true });
  });

  it('over the person’s limits: rate_limited, nothing recorded or scanned', async () => {
    limits.mockResolvedValueOnce({ ok: false, reason: 'user' });
    const { deps } = await setup();
    expect(await deps.checkLink('https://shop.example.com/')).toEqual({ status: 'unavailable', reason: 'rate_limited' });
    expect(recorded).toEqual([]);
    expect(runStoreScan).not.toHaveBeenCalled();
  });

  it('a failed scan marks the request failed and the card failed', async () => {
    runStoreScan.mockRejectedValueOnce(new Error('kernel down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, events } = await setup();
    expect(await deps.checkLink('https://shop.example.com/')).toEqual({ status: 'unavailable', reason: 'failed' });
    expect(finished).toEqual(['failed']);
    expect(events.at(-1)).toEqual({ type: 'scan_failed', storeId: 'cand-link', reason: 'failed' });
  });
});
