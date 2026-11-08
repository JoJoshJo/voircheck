import { describe, expect, it, vi } from 'vitest';
import { HENSARO_AD_URL, HENSARO_CLEAN_URL, HENSARO_REGISTERED, HENSARO_SCANNED, RECONSTRUCTED_PRODUCT_PAGE, SENT_AWAY, SX740_OFFERS } from './fixtures/hensaro-2026-11-07';
import type { KernelVisit, PageSnapshot, PageVisitor } from './kernel';
import { scanStore, type ScannerDeps } from './scan';
import type { ScanResult, WebReputation } from './schema';
import { notChecked, type WebResearcher } from './research';

// The 2026-11-07 miss (SAFE 25), end to end through scanStore with fixtures only: no network, no KERNEL, no AI.
// SENT_AWAY matches the stored scan; RECONSTRUCTED_PRODUCT_PAGE is rebuilt from J's description, never captured.

const NOW = new Date(HENSARO_SCANNED);

function fakeFetch(registered: string) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.startsWith('https://data.iana.org/')) return json({ services: [[['com'], ['https://rdap.example.test/']]] });
    if (url.startsWith('https://rdap.example.test/')) return json({ events: [{ eventAction: 'registration', eventDate: registered }] });
    if (url.startsWith('https://safebrowsing.googleapis.com/')) return json({});
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function visitorFor(page: PageSnapshot): PageVisitor & { visit: ReturnType<typeof vi.fn> } {
  return {
    visit: vi.fn(async (urls: string[]): Promise<KernelVisit> => ({ sessionId: 's', pages: urls.map(() => ({ ok: true as const, page })), sessionSeconds: 3 })),
  };
}

function deps(page: PageSnapshot, over: Partial<ScannerDeps> = {}): ScannerDeps & { visitor: ReturnType<typeof visitorFor> } {
  return {
    visitor: visitorFor(page),
    safeBrowsingKey: 'k',
    fetch: fakeFetch(HENSARO_REGISTERED),
    resolve: async () => ['93.184.215.14'],
    tlsCheck: async () => ({ valid: true, issuer: 'Google Trust Services', validFrom: new Date('2026-10-08T00:00:00Z') }),
    now: () => NOW,
    popularity: null,
    brands: null,
    ...over,
  } as ScannerDeps & { visitor: ReturnType<typeof visitorFor> };
}

const sig = (r: ScanResult, id: string) => r.signals.find((s) => s.id === id)!;

describe('hensaro.com (2026-11-07 miss)', () => {
  it('what we really got: the shop sent our check to google.com → couldn\'t verify, never SAFE, said plainly', async () => {
    const d = deps(SENT_AWAY);
    const { result } = await scanStore({ url: HENSARO_AD_URL, peers: [] }, d);
    expect(result.verdict).toBe('HOLD');
    expect(result.hardRulesTriggered).toContain('cant_verify');
    expect(sig(result, 'ssl_redirects').evidence).toContain("This shop sent our check to google.com instead of showing its product page. Real shops don't hide their pages.");
    // Google's own pages are not judged as if they were the shop.
    expect(sig(result, 'ai_page').status).toBe('unavailable');
    expect(sig(result, 'price').evidence.join(' ')).not.toMatch(/Bevor Sie/);
    expect(JSON.stringify(result)).not.toMatch(/cloaking/i);
  });

  it('tracking parameters are gone before the visit and from the result', async () => {
    const d = deps(SENT_AWAY);
    const { result } = await scanStore({ url: HENSARO_AD_URL, peers: [] }, d);
    expect(d.visitor.visit.mock.calls[0]![0]).toEqual([HENSARO_CLEAN_URL]);
    expect(result.url).toBe(HENSARO_CLEAN_URL);
    expect(result.url).not.toMatch(/gclid|utm_|gad_|stkn/);
  });

  it('the product page RECONSTRUCTED from J\'s description (not captured; $77 camera, Costco banner): price fails vs other stores, copycat fails on the banner → BLOCK', async () => {
    const findOffers = vi.fn(async () => SX740_OFFERS);
    const { result } = await scanStore({ url: HENSARO_AD_URL, peers: [] }, deps(RECONSTRUCTED_PRODUCT_PAGE, { findOffers }));
    expect(findOffers).toHaveBeenCalledWith('Canon PowerShot SX740 HS Digital Camera (Black)');
    const price = sig(result, 'price');
    expect(price.status).toBe('fail');
    // B&H 649, Adorama 679.99, Best Buy 699.99, Walmart 629 (not the case, the SX720, the blocked store or hensaro).
    expect(price.evidence[0]).toBe('$77.00 here vs $664.50 typical (the median of 4 other stores selling the same item).');
    expect(price.evidence.join(' ')).toMatch(/blocked were left out/);
    const clone = sig(result, 'clone');
    expect(clone.status).toBe('fail');
    expect(clone.evidence[0]).toMatch(/presents itself as Costco .*"Costco"\), but its address is hensaro\.com, not Costco's/);
    expect(result.verdict).toBe('BLOCK');
  });

  it('the same camera at a normal price on an old shop with no borrowed banner stays SAFE', async () => {
    const page: PageSnapshot = {
      ...RECONSTRUCTED_PRODUCT_PAGE,
      requestedUrl: 'https://camera-corner.example.com/p/sx740',
      finalUrl: 'https://camera-corner.example.com/p/sx740',
      redirectChain: ['https://camera-corner.example.com/p/sx740'],
      title: 'Canon PowerShot SX740 HS Digital Camera (Black) – Camera Corner',
      siteName: 'Camera Corner',
      pageFacts: { ...RECONSTRUCTED_PRODUCT_PAGE.pageFacts!, ldJson: [RECONSTRUCTED_PRODUCT_PAGE.pageFacts!.ldJson[0]!.replace('77.00', '659.00')], metaPrice: { amount: '659.00', currency: 'USD' }, logoAlts: ['Camera Corner'], bannerText: 'Free shipping over $50' },
    };
    const { result } = await scanStore({ url: 'https://camera-corner.example.com/p/sx740', peers: [] }, deps(page, { fetch: fakeFetch('2015-01-01T00:00:00Z'), findOffers: async () => SX740_OFFERS }));
    expect(sig(result, 'price').status).toBe('pass');
    expect(sig(result, 'clone').status).toBe('unavailable');
    expect(result.verdict).toBe('SAFE');
  });

  it('no comparable offers: price stays "not checked" and says why, with no numbers', async () => {
    const { result } = await scanStore({ url: HENSARO_CLEAN_URL, peers: [] }, deps(RECONSTRUCTED_PRODUCT_PAGE, { findOffers: async () => [] }));
    const price = sig(result, 'price');
    expect(price.status).toBe('unavailable');
    expect(price.evidence[0]).toMatch(/Not enough other trustworthy stores sell exactly "Canon PowerShot SX740 HS Digital Camera \(Black\)"/);
    expect(price.evidence.join(' ')).not.toMatch(/\$\d/);
  });
});

describe('no SAFE while price and copycat are unchecked and something is worth a look', () => {
  const plain = (url: string): PageSnapshot => ({
    ...RECONSTRUCTED_PRODUCT_PAGE,
    requestedUrl: url,
    finalUrl: url,
    redirectChain: [url],
    title: 'Hensaro – Home',
    siteName: 'Hensaro',
    h1: 'Welcome',
    visibleText: 'Welcome to our shop. New arrivals every week. Free shipping on all orders. Contact us any time.',
    fullText: 'Welcome to our shop.',
    pageFacts: { ldJson: [], metaPrice: null, metaTitle: null, logoAlts: ['Hensaro'], bannerText: 'Free shipping on all orders' },
  });

  it('a 4-month-old shop (domain "worth a look") whose price and copycat checks could not run → HOLD, "couldn\'t check everything"', async () => {
    const { result } = await scanStore({ url: 'https://hensaro.com/', peers: [] }, deps(plain('https://hensaro.com/')));
    expect(sig(result, 'domain_age').status).toBe('warn');
    expect(sig(result, 'price').status).toBe('unavailable');
    expect(sig(result, 'clone').status).toBe('unavailable');
    expect(result.score).toBeLessThan(30); // the score itself is unchanged
    expect(result.hardRulesTriggered).toEqual(['unchecked_core_signals']);
    expect(result.verdict).toBe('HOLD');
  });

  it('the same shop with a long-registered domain and nothing worth a look stays SAFE', async () => {
    const { result } = await scanStore({ url: 'https://hensaro.com/', peers: [] }, deps(plain('https://hensaro.com/'), { fetch: fakeFetch('2012-01-01T00:00:00Z') }));
    expect(result.hardRulesTriggered).toEqual([]);
    expect(result.verdict).toBe('SAFE');
  });
});

describe('research step inside the scan', () => {
  const warned: WebReputation = { status: 'warn', findings: [{ kind: 'complaint', note: { en: 'A buyer says the camera never arrived.', fr: 'Un acheteur dit que l’appareil n’est jamais arrivé.' }, sourceUrl: 'https://forum.example/t/1', sourceTitle: 'Never arrived' }], evidence: ['From a web search about hensaro.com (3 searches; the shop\'s own site is never searched).'] };
  const researcher = (over: Partial<WebResearcher> = {}): WebResearcher & { reputation: ReturnType<typeof vi.fn>; prices: ReturnType<typeof vi.fn> } =>
    ({
      reputation: vi.fn(async () => ({ reputation: warned, usage: { model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.06, cached: false, searches: 3 } })),
      prices: vi.fn(async () => ({ offers: null, usage: null })),
      ...over,
    }) as never;

  it('what the web says is part of the result (no points), and starts before the page visit ends', async () => {
    const r = researcher();
    const d = deps(SENT_AWAY, { researcher: r });
    let researchedBeforeVisitEnded = false;
    const visit = d.visitor.visit.getMockImplementation() as (urls: string[]) => Promise<KernelVisit>;
    d.visitor.visit.mockImplementation(async (urls: string[]) => {
      researchedBeforeVisitEnded = r.reputation.mock.calls.length > 0;
      return visit(urls);
    });
    const { result, meta } = await scanStore({ url: HENSARO_AD_URL, peers: [] }, d);
    expect(r.reputation).toHaveBeenCalledWith('hensaro.com');
    expect(researchedBeforeVisitEnded).toBe(true);
    expect(result.webReputation).toEqual(warned);
    expect(result.score).toBe(25); // unchanged: evidence only
    expect(meta.research[0]!.costUsd).toBe(0.06);
  });

  it('fewer than 3 comparable offers from Channel3 → web search prices fill in, and the $77 camera fails with the stores named', async () => {
    const r = researcher({
      prices: vi.fn(async () => ({
        offers: [
          { title: 'Canon PowerShot SX740 HS Digital Camera Black', price: 649, currency: 'USD', storeUrl: 'https://camera-store-a.example/canon-sx740-black' },
          { title: 'Canon PowerShot SX740 HS Digital Camera (Black)', price: 679, currency: 'USD', storeUrl: 'https://camera-store-b.example/p/sx740' },
          { title: 'Canon PowerShot SX740 HS Digital Camera', price: 659, currency: 'USD', storeUrl: 'https://camera-store-c.example/sx740hs' },
          { title: 'Canon PowerShot SX740 HS Digital Camera', price: 70, currency: 'USD', storeUrl: 'https://blocked-cams.example/sx740' },
        ],
        usage: null,
      })),
    });
    const verdictFor = vi.fn(async (u: string) => (u.includes('blocked-cams') ? ('BLOCK' as const) : undefined));
    const { result } = await scanStore({ url: HENSARO_CLEAN_URL, peers: [] }, deps(RECONSTRUCTED_PRODUCT_PAGE, { findOffers: async () => SX740_OFFERS.slice(0, 1), researcher: r, verdictFor }));
    expect(r.prices).toHaveBeenCalledWith({ name: 'Canon PowerShot SX740 HS Digital Camera (Black)', currency: 'USD', domain: 'hensaro.com' });
    const price = sig(result, 'price');
    expect(price.status).toBe('fail');
    expect(price.evidence[0]).toBe('$77.00 here vs $654.00 typical (the median of 4 other stores selling the same item).');
    expect(price.evidence.join(' ')).toMatch(/blocked were left out/);
    expect(price.evidence.at(-1)).toBe('Compared with: bhphotovideo.com, camera-store-a.example, camera-store-b.example, camera-store-c.example (found with a product search (Channel3) and a web search for the same item; web prices read by AI from search results).');
  });

  it('enough Channel3 offers → no web price search (cost)', async () => {
    const r = researcher();
    await scanStore({ url: HENSARO_CLEAN_URL, peers: [] }, deps(RECONSTRUCTED_PRODUCT_PAGE, { findOffers: async () => SX740_OFFERS, researcher: r }));
    expect(r.prices).not.toHaveBeenCalled();
  });

  const plain: PageSnapshot = {
    ...RECONSTRUCTED_PRODUCT_PAGE,
    title: 'Hensaro – Home',
    siteName: 'Hensaro',
    h1: 'Welcome',
    visibleText: 'Welcome to our shop. New arrivals every week. Free shipping on all orders.',
    fullText: 'Welcome to our shop.',
    pageFacts: { ldJson: [], metaPrice: null, metaTitle: null, logoAlts: ['Hensaro'], bannerText: '' },
  };

  it('what the web says was checked → "couldn\'t check everything" no longer applies', async () => {
    const { result } = await scanStore({ url: HENSARO_CLEAN_URL, peers: [] }, deps(plain, { researcher: researcher() }));
    expect(result.hardRulesTriggered).toEqual([]);
    expect(result.verdict).toBe('SAFE');
  });

  it('price, copycat AND what the web says all not checked, plus something worth a look → HOLD', async () => {
    const r = researcher({ reputation: vi.fn(async () => ({ reputation: notChecked('x'), usage: null })) });
    const { result } = await scanStore({ url: HENSARO_CLEAN_URL, peers: [] }, deps(plain, { researcher: r }));
    expect(result.hardRulesTriggered).toEqual(['unchecked_core_signals']);
    expect(result.verdict).toBe('HOLD');
  });

  it('a slow web search never holds up the scan: past the deadline it is "not checked"', async () => {
    const r = researcher({ reputation: vi.fn(() => new Promise<never>(() => {})) });
    const { result } = await scanStore({ url: HENSARO_CLEAN_URL, peers: [] }, deps(plain, { researcher: r, researchDeadlineMs: 20 }));
    expect(result.webReputation).toEqual(notChecked("The web search took too long, so what the web says wasn't checked."));
  });
});
