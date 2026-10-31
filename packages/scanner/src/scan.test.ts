import { describe, expect, it, vi } from 'vitest';
import type { KernelVisit, PageSnapshot, PageVisitor } from './kernel';
import { scanStore, type ScannerDeps } from './scan';
import { ScanResult } from './schema';
import { assertSafeUrlShape, isPublicIp, resolvePublicHost, SsrfError } from './ssrf';

const NOW = new Date('2026-10-28T12:00:00Z');
const PUBLIC_IP = '93.184.215.14';

// ---------- fakes (no network) ----------

function fakeFetch(registeredDaysAgo: number, threat = false) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.startsWith('https://data.iana.org/')) return json({ services: [[['com', 'shop'], ['https://rdap.example.test/']]] });
    if (url.startsWith('https://rdap.example.test/')) {
      return json({ events: [{ eventAction: 'registration', eventDate: new Date(NOW.getTime() - registeredDaysAgo * 86_400_000).toISOString() }] });
    }
    if (url.startsWith('https://safebrowsing.googleapis.com/')) {
      return json(threat ? { matches: [{ threatType: 'SOCIAL_ENGINEERING', threat: { url: 'https://velbrook-outlet.shop/' } }] } : {});
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function snapshot(url: string, siteName: string, text: string): PageSnapshot {
  return {
    requestedUrl: url,
    finalUrl: url,
    redirectChain: [url],
    httpStatus: 200,
    title: `Zephlet Buds · ${siteName}`,
    siteName,
    h1: 'Zephlet Buds',
    visibleText: text,
    fullText: text,
    structure: ['body', 'div', 'header', 'a', 'nav', 'a', 'a', 'main', 'h1', 'p', 'button', 'footer'],
    aboutUrl: null,
    aboutText: null,
    links: [],
    hiddenCandidates: [],
  };
}

const LEGIT_TEXT = (name: string, price: number) =>
  `Fictional demo store. ${name}. Zephlet Buds $${price}.00 Clear calls, all-day battery. We test every product ourselves and ship from our own warehouse. Free returns for thirty days on every order. Questions? Our team answers within one business day.`;

const PAGES: Record<string, PageSnapshot> = {
  'https://velbrook.com/': snapshot('https://velbrook.com/', 'Velbrook Supply', LEGIT_TEXT('Velbrook Supply', 59)),
  'https://velbrook-outlet.shop/': snapshot('https://velbrook-outlet.shop/', 'Velbrook-Outlet Deals', LEGIT_TEXT('Velbrook-Outlet Deals', 23)),
  'https://ondaya.com/': snapshot(
    'https://ondaya.com/',
    'Ondaya Home',
    'Fictional demo store. Ondaya Home. Zephlet Buds $59.00 Calm, durable things for the house, chosen slowly. Ships worldwide from Accra, Ghana. Call us any weekday.',
  ),
};

function fakeVisitor(behavior: 'ok' | 'throw' | 'timeout' = 'ok'): PageVisitor & { visit: ReturnType<typeof vi.fn> } {
  return {
    visit: vi.fn(async (urls: string[], hooks?: { onSession?: (s: { sessionId: string; liveViewUrl?: string }) => void }): Promise<KernelVisit> => {
      if (behavior === 'throw') throw new Error('KERNEL API 503');
      hooks?.onSession?.({ sessionId: 'sess_test', liveViewUrl: 'https://live.example.test/sess_test' });
      return {
        sessionId: 'sess_test',
        liveViewUrl: 'https://live.example.test/sess_test',
        pages: urls.map((u) => (behavior === 'timeout' ? { ok: false, error: 'cloud browser visit timed out after 90s' } : PAGES[u] ? { ok: true, page: PAGES[u]! } : { ok: false, error: '404' })),
        sessionSeconds: 4,
      };
    }),
  };
}

function deps(over: Partial<ScannerDeps> & { ageDays?: number; threat?: boolean } = {}): ScannerDeps {
  return {
    visitor: fakeVisitor(),
    safeBrowsingKey: 'test-key',
    fetch: fakeFetch(over.ageDays ?? 3000, over.threat),
    resolve: async () => [PUBLIC_IP],
    tlsCheck: async () => ({ valid: true, issuer: "Let's Encrypt", validFrom: new Date('2026-10-01T00:00:00Z') }),
    now: () => NOW,
    ...over,
  };
}

const signal = (r: ScanResult, id: string) => r.signals.find((s) => s.id === id)!;

// ---------- SSRF ----------

describe('SSRF guards', () => {
  it.each(['127.0.0.1', '10.0.0.8', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00:ec2::254', '::ffff:10.0.0.1', '224.0.0.1'])(
    'blocks %s',
    (ip) => expect(isPublicIp(ip)).toBe(false),
  );
  it('allows public addresses', () => {
    expect(isPublicIp(PUBLIC_IP)).toBe(true);
    expect(isPublicIp('2606:4700::6810:84e5')).toBe(true);
  });

  it.each([
    'ftp://a.com/',
    'file:///etc/passwd',
    'http://localhost/',
    'http://user:pw@a.com/',
    'http://a.com:8080/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://metadata.google.internal/',
    'http://intranet/',
    'http://printer.local/',
  ])('rejects %s', (u) => expect(() => assertSafeUrlShape(u)).toThrow(SsrfError));

  it('resolve-then-check blocks a public name that resolves to a private IP (DNS rebinding)', async () => {
    await expect(resolvePublicHost('evil.example', async () => [PUBLIC_IP, '127.0.0.1'])).rejects.toThrow(SsrfError);
    await expect(resolvePublicHost('meta.example', async () => ['169.254.169.254'])).rejects.toThrow(SsrfError);
    await expect(resolvePublicHost('ok.example', async () => [PUBLIC_IP])).resolves.toEqual([PUBLIC_IP]);
  });

  it('scanStore refuses before calling KERNEL or any lookup', async () => {
    const d = deps({ resolve: async () => ['10.1.2.3'] });
    await expect(scanStore({ url: 'https://internal.example.com/' }, d)).rejects.toThrow(SsrfError);
    expect((d.visitor as ReturnType<typeof fakeVisitor>).visit).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed input and over-long URLs with Zod', async () => {
    await expect(scanStore({ url: 'not a url' }, deps())).rejects.toThrow();
    await expect(scanStore({ url: `https://a.com/${'x'.repeat(2100)}` }, deps())).rejects.toThrow();
  });
});

// ---------- full scan with fakes ----------

describe('scanStore', () => {
  it('Velbrook-Outlet clone at 61% below peers → BLOCK', async () => {
    const { result } = await scanStore(
      { url: 'https://velbrook-outlet.shop/', peers: [{ url: 'https://velbrook.com/' }, { url: 'https://ondaya.com/' }, { url: 'https://nyuie.com/', price: 58, productTitle: 'Zephlet Buds' }] },
      deps(),
    );
    expect(signal(result, 'price').status).toBe('fail');
    expect(signal(result, 'clone').status).toBe('fail');
    expect(signal(result, 'ai_page')).toMatchObject({ status: 'unavailable', points: 0, evidence: ['AI analysis not yet enabled'] });
    expect(result.verdict).toBe('BLOCK');
    expect(result.kernel).toEqual({ sessionId: 'sess_test', liveViewUrl: 'https://live.example.test/sess_test' });
  });

  it('reports progress: the browser session first, then all six signals', async () => {
    const events: Array<{ type: string; id?: string }> = [];
    await scanStore({ url: 'https://velbrook-outlet.shop/', peers: [{ url: 'https://velbrook.com/' }, { url: 'https://ondaya.com/' }] }, deps({ onProgress: (e) => events.push(e) }));
    expect(events.filter((e) => e.type === 'browser')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'signal').map((e) => e.id).sort()).toEqual(['ai_page', 'clone', 'domain_age', 'price', 'ssl_redirects', 'threat_list']);
  });

  it('a throwing progress listener does not break the scan', async () => {
    const { result } = await scanStore({ url: 'https://velbrook.com/' }, deps({ onProgress: () => { throw new Error('ui gone'); } }));
    expect(result.signals).toHaveLength(6);
  });

  it('the original store is SAFE even when its copy is a peer', async () => {
    const { result } = await scanStore({ url: 'https://velbrook.com/', peers: [{ url: 'https://velbrook-outlet.shop/' }, { url: 'https://ondaya.com/' }] }, deps());
    expect(signal(result, 'clone').status).toBe('pass');
    expect(result.verdict).toBe('SAFE');
    expect(result.score).toBe(0);
  });

  it('young domain + price >40% below → hard rule HOLD at least', async () => {
    const { result } = await scanStore(
      { url: 'https://ondaya.com/', price: 20, peers: [{ url: 'https://velbrook.com/', price: 59 }, { url: 'https://velbrook-outlet.shop/', price: 59 }, { url: 'https://nyuie.com/', price: 58 }] },
      deps({ ageDays: 5 }),
    );
    expect(result.hardRulesTriggered).toContain('young_domain_cheap_price');
    expect(result.verdict).not.toBe('SAFE');
  });

  it("a BLOCK store's price never enters the comparison (the live $23 Velbrook-Outlet bug)", async () => {
    const peers = [
      { url: 'https://velbrook-outlet.shop/', price: 23, verdict: 'BLOCK' as const },
      { url: 'https://ondaya.com/', price: 62 },
      { url: 'https://nyuie.com/', price: 58 },
    ];
    const two = await scanStore({ url: 'https://velbrook.com/', price: 59, peers }, deps());
    expect(signal(two.result, 'price')).toMatchObject({ status: 'unavailable', points: 0 }); // only 2 valid offers left
    expect(signal(two.result, 'price').evidence.join(' ')).not.toContain('23');
    const three = await scanStore({ url: 'https://velbrook.com/', price: 59, peers: [...peers, { url: 'https://zero.example/', price: 56 }] }, deps());
    expect(signal(three.result, 'price').evidence[0]).toBe('$59.00 here vs $58.00 typical (the median of 3 other stores selling the same item).');
  });

  it('the scanned store is never in its own comparison set (other pages of the same store included)', async () => {
    const base = 'https://voircheck-stores.onrender.com/s';
    const { result } = await scanStore(
      {
        url: `${base}/velbrook-supply`,
        price: 59,
        peers: [
          { url: `${base}/velbrook-supply/products/zephlet-buds`, price: 10 },
          { url: `${base}/ondaya-home`, price: 62 },
          { url: `${base}/nyuie-market`, price: 58 },
        ],
      },
      deps(),
    );
    expect(signal(result, 'price').status).toBe('unavailable');
  });

  it('peers listing a different product are left out of the price comparison', async () => {
    const { result } = await scanStore(
      {
        url: 'https://ondaya.com/',
        price: 20,
        productTitle: 'Zephlet Buds',
        peers: [{ url: 'https://velbrook.com/', price: 59, productTitle: 'Zephlet Buds' }, { url: 'https://velbrook-outlet.shop/', price: 79, productTitle: 'Acme Buds Pro' }],
      },
      deps(),
    );
    expect(signal(result, 'price')).toMatchObject({ status: 'unavailable', points: 0 });
  });

  it('sameProduct: false → price unavailable', async () => {
    const { result } = await scanStore({ url: 'https://ondaya.com/', price: 20, sameProduct: false, peers: [{ url: 'https://velbrook.com/', price: 59 }, { url: 'https://velbrook-outlet.shop/', price: 59 }] }, deps());
    expect(signal(result, 'price').status).toBe('unavailable');
  });

  it("refuses Channel3's buy.trychannel3.com redirect links (scan the retailer page instead)", async () => {
    await expect(scanStore({ url: 'https://buy.trychannel3.com/8748UGP-p1PB-23L6YR?o=1' }, deps())).rejects.toThrow('Channel3 buy link');
    await expect(scanStore({ url: 'https://velbrook.com/', peers: [{ url: 'https://buy.trychannel3.com/x' }] }, deps())).rejects.toThrow();
  });

  it('threat-list hit → BLOCK', async () => {
    const { result } = await scanStore({ url: 'https://velbrook.com/' }, deps({ threat: true }));
    expect(result.hardRulesTriggered).toContain('threat_list_hit');
    expect(result.verdict).toBe('BLOCK');
  });

  it('invalid certificate → at least HOLD', async () => {
    const { result } = await scanStore({ url: 'https://velbrook.com/' }, deps({ visitor: fakeVisitor('timeout'), tlsCheck: async () => ({ valid: false, error: 'certificate has expired' }) }));
    expect(signal(result, 'ssl_redirects').status).toBe('fail');
    expect(result.hardRulesTriggered).toContain('no_valid_https');
  });

  it.each(['throw', 'timeout'] as const)("KERNEL %s → can't verify → HOLD, never SAFE", async (behavior) => {
    const { result, meta } = await scanStore({ url: 'https://velbrook.com/', peers: [{ url: 'https://ondaya.com/' }] }, deps({ visitor: fakeVisitor(behavior) }));
    expect(result.hardRulesTriggered).toContain('cant_verify');
    expect(result.verdict).toBe('HOLD');
    expect(meta.kernelError).toBeTruthy();
    expect(signal(result, 'ssl_redirects').evidence.join(' ')).toContain("Couldn't verify this store");
  });

  it("a bot-check page is never SAFE: page signals unavailable, can't verify → HOLD", async () => {
    const challenge: PageSnapshot = {
      ...snapshot('https://velbrook.com/', 'velbrook.com', 'Checking your browser before accessing velbrook.com. This process is automatic.'),
      title: 'velbrook.com',
      h1: 'Checking your browser before accessing velbrook.com',
    };
    const visitor: PageVisitor = { visit: async (urls) => ({ sessionId: 's', pages: urls.map(() => ({ ok: true as const, page: challenge })), sessionSeconds: 2 }) };
    const { result, meta } = await scanStore({ url: 'https://velbrook.com/' }, deps({ visitor }));
    expect(result.hardRulesTriggered).toContain('cant_verify');
    expect(result.verdict).toBe('HOLD');
    expect(meta.kernelError).toBe('blocked by a bot check');
    for (const id of ['price', 'ai_page', 'clone']) expect(signal(result, id).status).toBe('unavailable');
    expect(signal(result, 'price').evidence.join(' ')).toContain('blocked by a bot check');
    expect(signal(result, 'ai_page').evidence.join(' ')).toContain('blocked by a bot check');
    expect(signal(result, 'ssl_redirects').evidence.join(' ')).toContain("Couldn't verify this store: blocked by a bot check");
    // The navigation itself was real, so HTTPS/redirect facts still count.
    expect(signal(result, 'ssl_redirects').status).toBe('pass');
  });

  it('well-known-site rank is evidence only: same points and verdict, shown under domain age', async () => {
    const famous = await scanStore({ url: 'https://velbrook.com/' }, deps({ popularity: () => 1302 }));
    const unknown = await scanStore({ url: 'https://velbrook.com/' }, deps({ popularity: () => null }));
    expect(famous.result.score).toBe(unknown.result.score);
    expect(famous.result.verdict).toBe(unknown.result.verdict);
    expect(signal(famous.result, 'domain_age').evidence.join(' ')).toContain('Well-known site: velbrook.com is #1,302');
    expect(signal(famous.result, 'domain_age').points).toBe(signal(unknown.result, 'domain_age').points);
    // A bot wall on a well-known site is still "couldn't verify" this round.
    const walled = await scanStore({ url: 'https://velbrook.com/' }, deps({ popularity: () => 1302, visitor: fakeVisitor('timeout') }));
    expect(walled.result.verdict).toBe('HOLD');
  });

  it('no KERNEL configured → HOLD', async () => {
    const { result } = await scanStore({ url: 'https://velbrook.com/' }, deps({ visitor: null }));
    expect(result.verdict).toBe('HOLD');
    expect(result.kernel.sessionId).toBeNull();
  });

  it('Safe Browsing down → threat signal unavailable, not a pass', async () => {
    const failing = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('safebrowsing')) return new Response('nope', { status: 500 });
      return (fakeFetch(3000) as unknown as (i: string | URL | Request) => Promise<Response>)(input);
    }) as unknown as typeof fetch;
    const { result } = await scanStore({ url: 'https://velbrook.com/' }, deps({ fetch: failing }));
    expect(signal(result, 'threat_list').status).toBe('unavailable');
  });

  it('sends the Safe Browsing key in a header, never in the URL', async () => {
    const d = deps();
    await scanStore({ url: 'https://velbrook.com/' }, d);
    const call = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).includes('safebrowsing'))!;
    expect(String(call[0])).not.toContain('test-key');
    expect((call[1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
  });
});

// ---------- output validation ----------

describe('ScanResult schema', () => {
  it('accepts a real result and rejects broken ones', async () => {
    const { result } = await scanStore({ url: 'https://velbrook.com/' }, deps());
    expect(ScanResult.safeParse(result).success).toBe(true);
    expect(ScanResult.safeParse({ ...result, score: 101 }).success).toBe(false);
    expect(ScanResult.safeParse({ ...result, verdict: 'MAYBE' }).success).toBe(false);
    expect(ScanResult.safeParse({ ...result, signals: result.signals.slice(1) }).success).toBe(false);
    expect(ScanResult.safeParse({ ...result, signals: [...result.signals].reverse() }).success).toBe(false);
    expect(ScanResult.safeParse({ ...result, signals: [{ ...result.signals[0]!, status: 'ok' }, ...result.signals.slice(1)] }).success).toBe(false);
    expect(ScanResult.safeParse({ ...result, hardRulesTriggered: ['vibes'] }).success).toBe(false);
  });
});
