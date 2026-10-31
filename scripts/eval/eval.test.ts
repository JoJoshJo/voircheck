import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SIGNAL_IDS, type ScanReport, type SignalStatus, type Verdict } from '@voircheck/scanner';
import { computeMetrics, loadStores, median, type EvalRow, type Label } from './metrics';
import { checkReachability, classify, relatedDomains } from './reachability';
import { markdownReport } from './report';
import { mapPool, selectStores, toRow } from './run';

const signals = (over: Partial<Record<(typeof SIGNAL_IDS)[number], SignalStatus>> = {}) =>
  SIGNAL_IDS.map((id) => ({ id, status: over[id] ?? (id === 'ai_page' ? 'unavailable' : 'pass'), points: 0, evidence: [`${id} evidence`] }));

const scanned = (url: string, label: Label, verdict: Verdict, extra: Partial<Extract<EvalRow, { outcome: 'scanned' }>> = {}): EvalRow => ({
  url,
  label,
  split: 'test',
  outcome: 'scanned',
  verdict,
  score: verdict === 'BLOCK' ? 80 : verdict === 'HOLD' ? 40 : 5,
  hardRules: [],
  signals: signals(),
  scanMs: 10_000,
  kernelError: null,
  ...extra,
});

describe('eval metrics', () => {
  const rows: EvalRow[] = [
    scanned('https://s1.test/', 'scam', 'BLOCK', { signals: signals({ domain_age: 'fail', clone: 'warn' }), scanMs: 8_000 }),
    scanned('https://s2.test/', 'scam', 'HOLD', { hardRules: ['cant_verify'], signals: signals({ ssl_redirects: 'unavailable' }), scanMs: 20_000 }),
    scanned('https://s3.test/', 'scam', 'SAFE', { scanMs: 12_000 }),
    { url: 'https://s4.test/', label: 'scam', split: 'test', outcome: 'dead', deadReason: 'parked / for-sale page' },
    scanned('https://l1.test/', 'legit', 'SAFE', { scanMs: 9_000 }),
    scanned('https://l2.test/', 'legit', 'SAFE', { scanMs: 11_000 }),
    scanned('https://l3.test/', 'legit', 'HOLD', { signals: signals({ domain_age: 'warn' }), scanMs: 30_000 }),
    scanned('https://l4.test/', 'legit', 'BLOCK', { signals: signals({ threat_list: 'fail' }), scanMs: 7_000 }),
    { url: 'https://l5.test/', label: 'legit', split: 'test', outcome: 'dead', deadReason: 'HTTP 503' },
    { url: 'https://l6.test/', label: 'legit', split: 'test', outcome: 'error', error: 'SsrfError: hostname did not resolve' },
  ];
  const m = computeMetrics(rows);

  it('excludes dead sites and runner errors from accuracy, and counts them', () => {
    expect(m.total).toBe(10);
    expect(m.dead).toBe(2);
    expect(m.deadByLabel).toEqual({ scam: 1, legit: 1 });
    expect(m.errors).toBe(1);
    expect(m.scored).toEqual({ scam: 3, legit: 4 });
  });

  it('scam caught = HOLD or BLOCK; legit HOLD = soft, BLOCK = hard false alarm', () => {
    expect(m.scam).toEqual({ BLOCK: 1, HOLD: 1, SAFE: 1 });
    expect(m.legit).toEqual({ SAFE: 2, HOLD: 1, BLOCK: 1 });
    expect(m.catchRate).toBeCloseTo(2 / 3);
    expect(m.softFalseAlarmRate).toBe(0.25);
    expect(m.hardFalseAlarmRate).toBe(0.25);
    expect(m.misses.map((r) => r.url)).toEqual(['https://s3.test/']);
    expect(m.falseAlarms.map((r) => r.url)).toEqual(['https://l3.test/', 'https://l4.test/']);
  });

  it('flags scams caught only because the scan could not verify the store', () => {
    expect(m.scamCaughtByCantVerifyOnly).toBe(1);
  });

  it('per-signal hit rate = fail+warn over available rows; coverage = available share', () => {
    expect(m.perSignal.scam.domain_age).toMatchObject({ hitRate: 1 / 3, coverage: 1 });
    expect(m.perSignal.scam.clone?.hitRate).toBeCloseTo(1 / 3);
    expect(m.perSignal.scam.ssl_redirects).toMatchObject({ hitRate: 0, coverage: 2 / 3 });
    expect(m.perSignal.scam.ai_page).toMatchObject({ hitRate: null, coverage: 0 });
    expect(m.perSignal.legit.threat_list?.hitRate).toBe(0.25);
  });

  it('median scan time over scanned rows only', () => {
    expect(m.medianScanMs).toBe(11_000);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('counts collected facts per label over scored rows (free-mail: scam X/N, legit Y/M)', () => {
    const facts = (freeMail: boolean, kinds: Array<'home' | 'legal' | 'contact'>) => ({
      pages: kinds.map((kind) => ({ url: 'https://x.test/', kind, title: '' })),
      facts: { companyNames: [], addresses: [], phones: [], emails: [], freeMailContact: freeMail, registrationIds: [], paymentMethods: [], returnPolicy: false, discountsPct: freeMail ? [70] : [] },
    });
    const fm = computeMetrics([
      scanned('https://a.test/', 'scam', 'SAFE', { collected: facts(true, ['home', 'contact']) }),
      scanned('https://b.test/', 'scam', 'HOLD'), // bot check: nothing collected
      scanned('https://c.test/', 'legit', 'SAFE', { collected: facts(false, ['home', 'legal']) }),
      { url: 'https://d.test/', label: 'scam', split: 'test', outcome: 'dead', deadReason: 'parked / for-sale page' },
    ]);
    const row = (name: string) => fm.facts.find((f) => f.fact === name);
    expect(row('free-mail contact email')).toEqual({ fact: 'free-mail contact email', scam: 1, legit: 0 });
    expect(row('legal notice / Impressum page')).toMatchObject({ scam: 0, legit: 1 });
    expect(row('discount of 50% or more seen')).toMatchObject({ scam: 1, legit: 0 });
    const md = markdownReport(fm, [], { runAt: '2026-10-30T00:00:00Z', split: 'test', commit: 'abc', aiAnalysis: 'off' });
    expect(md).toContain('| free-mail contact email | 1/2 | 0/1 |');
  });

  it('empty or all-dead sets give n/a rates, never NaN', () => {
    const e = computeMetrics([{ url: 'https://x.test/', label: 'scam', split: 'test', outcome: 'dead', deadReason: 'HTTP 404' }]);
    expect(e.catchRate).toBeNull();
    expect(e.hardFalseAlarmRate).toBeNull();
    expect(markdownReport(e, [], { runAt: '2026-10-30T00:00:00Z', split: 'test', commit: 'abc', aiAnalysis: 'off' })).toContain('n/a');
  });

  it('the report states sample size, AI off, and lists misses + false alarms with signal values', () => {
    const md = markdownReport(m, rows, { runAt: '2026-10-30T12:00:00Z', split: 'test', commit: 'abc1234', aiAnalysis: 'off' });
    expect(md).toContain('AI page analysis: OFF');
    expect(md).toContain('scored 3 scam + 4 legit');
    expect(md).toContain('2 dead');
    expect(md).toContain('#### https://s3.test/ — scam, SAFE');
    expect(md).toContain('#### https://l4.test/ — legit, BLOCK');
    expect(md).toContain('- **threat_list**: fail (0 pts) — threat_list evidence');
    expect(md).toContain('https://l5.test/ (legit): dead — HTTP 503');
  });
});

describe('dataset', () => {
  const stores = loadStores(JSON.parse(readFileSync(new URL('../../eval/stores.json', import.meta.url), 'utf8')));
  it('every entry has a named source; split is ~1/3 tune per label', () => {
    for (const label of ['scam', 'legit'] as const) {
      const xs = stores.filter((s) => s.label === label);
      expect(xs.length).toBeGreaterThanOrEqual(25);
      const tune = xs.filter((s) => s.split === 'tune').length / xs.length;
      expect(tune).toBeGreaterThan(0.25);
      expect(tune).toBeLessThan(0.4);
    }
    expect(stores.every((s) => s.sourceUrl.startsWith('https://'))).toBe(true);
    expect(stores.some((s) => s.url.includes('voircheck'))).toBe(false); // no demo stores
  });
  it('rejects entries without a source', () => {
    expect(() => loadStores({ stores: [{ url: 'https://a.test/', label: 'scam', split: 'test', source: '', sourceUrl: '' }] })).toThrow(/named source/);
  });
  it('selects by split and limit', () => {
    expect(selectStores(stores, 'tune').every((s) => s.split === 'tune')).toBe(true);
    expect(selectStores(stores, 'all', 3)).toHaveLength(3);
  });
});

describe('reachability (dead-site detection)', () => {
  it('dead = DNS failure, refused/timed-out connection, parked page, or unrelated redirect', () => {
    expect(classify({ startUrl: 'https://a.test/', error: 'ENOTFOUND' })).toEqual({ alive: false, reason: 'unreachable: ENOTFOUND' });
    for (const error of ['EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'TimeoutError', 'UND_ERR_CONNECT_TIMEOUT']) expect(classify({ startUrl: 'https://a.test/', error }).alive).toBe(false);
    expect(classify({ startUrl: 'https://shop.de/', status: 200, body: '<h1>Diese Domain kaufen</h1> sedo' })).toEqual({ alive: false, reason: 'parked / for-sale page' });
    expect(classify({ startUrl: 'https://shop.de/', finalUrl: 'https://other-thing.com/', status: 200 }).alive).toBe(false);
  });
  it('certificate problems and HTTP errors are NOT dead: they are scanned and judged', () => {
    for (const error of ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ECONNRESET']) {
      expect(classify({ startUrl: 'https://dieroester.at/', error })).toMatchObject({ alive: true, finalUrl: 'https://dieroester.at/' });
    }
    for (const status of [404, 410, 502, 503]) expect(classify({ startUrl: 'https://a.test/', status })).toEqual({ alive: true, finalUrl: 'https://a.test/', note: `HTTP ${status}` });
  });
  it('an expired certificate from fetch (error.cause.code) is scanned, not dead', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    });
    expect(await checkReachability('https://a.example/', { fetch: fetchMock as typeof fetch, resolve: async () => ['93.184.216.34'] })).toMatchObject({ alive: true });
    const dns = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    });
    expect(await checkReachability('https://a.example/', { fetch: dns as typeof fetch, resolve: async () => ['93.184.216.34'] })).toMatchObject({ alive: false });
  });
  it('keeps bot-protected and same-site redirects alive', () => {
    expect(classify({ startUrl: 'https://www.shop.de/', status: 403 }).alive).toBe(true);
    expect(classify({ startUrl: 'https://shop.de/', finalUrl: 'https://www.shop.de/de/', status: 200, body: '<h1>Shop</h1>' }).alive).toBe(true);
    expect(relatedDomains('https://brand.com/', 'https://www.brand.de/')).toBe(true);
    expect(relatedDomains('https://mall.elvaritaro.com/', 'https://elvaritaro.com/')).toBe(true);
  });
  it('follows redirects manually with the SSRF guard on every hop', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url) === 'https://a.example/' ? new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/admin' } }) : new Response('ok'),
    );
    const r = await checkReachability('https://a.example/', { fetch: fetchMock as typeof fetch, resolve: async () => ['93.184.216.34'] });
    expect(r.alive).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the private hop is never requested
  });
  it('a live page passes', async () => {
    const fetchMock = vi.fn(async () => new Response('<html><h1>Welcome to our shop</h1></html>', { status: 200 }));
    expect(await checkReachability('https://a.example/', { fetch: fetchMock as typeof fetch, resolve: async () => ['93.184.216.34'] })).toEqual({ alive: true, finalUrl: 'https://a.example/' });
  });
});

describe('runner rows', () => {
  it('never copies KERNEL session ids or live-view/replay links into results', () => {
    const report: ScanReport = {
      result: {
        url: 'https://a.test/',
        domain: 'a.test',
        signals: signals(),
        score: 10,
        verdict: 'SAFE',
        hardRulesTriggered: [],
        kernel: { sessionId: 'sess_secret', liveViewUrl: 'https://live.kernel.example/x?jwt=SECRET', replayUrl: 'https://replay.kernel.example/y?token=SECRET' },
        scannedAt: '2026-10-30T00:00:00.000Z',
      },
      meta: { kernelSessionSeconds: 12, kernelError: null },
    };
    const row = toRow({ url: 'https://a.test/', label: 'legit', split: 'test', source: 's', sourceUrl: 'https://s.test', addedOn: '', notes: '' }, report, 1234.6);
    const json = JSON.stringify(row);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('sess_secret');
    expect(row).toMatchObject({ outcome: 'scanned', verdict: 'SAFE', scanMs: 1235 });
  });
  it('mapPool keeps order and never runs more than the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, 0, async (x) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
