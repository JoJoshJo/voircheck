import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({ release: [] as Array<() => void>, scans: 0, cached: false }));
vi.mock('../db', () => ({ getDb: () => ({}) }));
vi.mock('../paypal', () => ({ getPayPal: () => ({}) }));
vi.mock('../scan-view', () => ({ toScanView: (r: unknown) => r }));
vi.mock('./core', async (orig) => ({ ...(await orig<typeof import('./core')>()), storeOutput: () => ({ ok: 1 }) }));
vi.mock('@voircheck/agent/search', () => ({ demoPeersForUrl: () => null }));
vi.mock('../scans', () => ({
  canonicalUrl: (u: string) => u,
  findFreshScan: async () => (h.cached ? { id: 'cached' } : null),
  recordLinkRequest: async () => ({ sessionId: 's', candidateId: 'c' }),
  finishLinkRequest: async () => {},
}));
vi.mock('../rate-limit', async (orig) => ({ ...(await orig<typeof import('../rate-limit')>()), checkScanLimits: async () => ({ ok: true }) }));
vi.mock('../scan-runner', async () => {
  class ScanBusyError extends Error {}
  return {
    ScanBusyError,
    runStoreScan: () =>
      new Promise((ok) => {
        h.scans++;
        h.release.push(() => ok({ id: `scan-${h.scans}` }));
      }),
  };
});

const { mcpApi, MCP_FRESH_SCANS_PER_TOKEN_PER_HOUR } = await import('./api');
const tick = () => new Promise((r) => setTimeout(r, 0));
let n = 0;
const owner = () => ({ tokenId: `token-${++n}`, userId: `user-${n}`, isGuest: false });
const ctx = { ip: '203.0.113.7', origin: 'http://localhost:3000' };

beforeEach(() => {
  h.release = [];
  h.scans = 0;
  h.cached = false;
});

describe('check_store per-token limits', () => {
  it('one fresh scan at a time per token: a second call while one runs is refused, and allowed after', async () => {
    const api = mcpApi(owner(), ctx);
    const first = api.checkStore('https://a.example/');
    await tick();
    expect(await api.checkStore('https://b.example/')).toEqual({ ok: false, error: 'scan_running' });
    h.release.shift()!();
    expect((await first).ok).toBe(true);
    const third = api.checkStore('https://c.example/');
    await tick();
    h.release.shift()!();
    expect((await third).ok).toBe(true);
    expect(h.scans).toBe(2);
  });

  it('another token of the same person is not blocked by it', async () => {
    const o = owner();
    const a = mcpApi(o, ctx).checkStore('https://a.example/');
    await tick();
    const b = mcpApi({ ...o, tokenId: `${o.tokenId}-b` }, ctx).checkStore('https://b.example/');
    await tick();
    expect(h.scans).toBe(2);
    h.release.splice(0).forEach((r) => r());
    expect([(await a).ok, (await b).ok]).toEqual([true, true]);
  });

  it(`at most ${MCP_FRESH_SCANS_PER_TOKEN_PER_HOUR} fresh scans per token per hour`, async () => {
    const api = mcpApi(owner(), ctx);
    for (let i = 0; i < MCP_FRESH_SCANS_PER_TOKEN_PER_HOUR; i++) {
      const p = api.checkStore(`https://s${i}.example/`);
      await tick();
      h.release.shift()!();
      expect((await p).ok).toBe(true);
    }
    expect(await api.checkStore('https://one-more.example/')).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('cached verdicts are not fresh scans: no per-token limit', async () => {
    h.cached = true;
    const api = mcpApi(owner(), ctx);
    const all = await Promise.all(Array.from({ length: MCP_FRESH_SCANS_PER_TOKEN_PER_HOUR + 3 }, (_, i) => api.checkStore(`https://c${i}.example/`)));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(h.scans).toBe(0);
  });
});
