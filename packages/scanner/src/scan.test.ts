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
    visit: vi.fn(async (urls: string[]): Promise<KernelVisit> => {
      if (behavior === 'throw') throw new Error('KERNEL API 503');
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
    const { result } = await scanStore({ url: 'https://velbrook-outlet.shop/', peers: [{ url: 'https://velbrook.com/' }, { url: 'https://ondaya.com/' }] }, deps());
    expect(signal(result, 'price').status).toBe('fail');
    expect(signal(result, 'clone').status).toBe('fail');
    expect(signal(result, 'ai_page')).toMatchObject({ status: 'unavailable', points: 0, evidence: ['AI analysis not yet enabled'] });
    expect(result.verdict).toBe('BLOCK');
    expect(result.kernel).toEqual({ sessionId: 'sess_test', liveViewUrl: 'https://live.example.test/sess_test' });
  });

  it('the original store is SAFE even when its copy is a peer', async () => {
    const { result } = await scanStore({ url: 'https://velbrook.com/', peers: [{ url: 'https://velbrook-outlet.shop/' }, { url: 'https://ondaya.com/' }] }, deps());
    expect(signal(result, 'clone').status).toBe('pass');
    expect(result.verdict).toBe('SAFE');
    expect(result.score).toBe(0);
  });

  it('young domain + price >40% below → hard rule HOLD at least', async () => {
    const { result } = await scanStore(
      { url: 'https://ondaya.com/', price: 20, peers: [{ url: 'https://velbrook.com/', price: 59 }] },
      deps({ ageDays: 5 }),
    );
    expect(result.hardRulesTriggered).toContain('young_domain_cheap_price');
    expect(result.verdict).not.toBe('SAFE');
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
