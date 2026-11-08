import { describe, expect, it, vi } from 'vitest';
import { detectSentAway, sameShopName } from './blocked-page';
import { domainInfo } from './domain';
import { authoritySource, PRICE_SYSTEM_PROMPT, reputationStatus, WEB_POINTS, webEvidenceStrength, type WebResearcher } from './research';
import { pastedLinkPrice } from './scan';
import { SIGNAL_IDS, type SignalId, type SignalStatus, type WebFinding } from './schema';
import { hardRules, score, webPoints } from './scoring';
import { CRT_SH, domainAgeSignal, parseCrtSh } from './signals/domain-age';
import type { ScanFacts, SignalOutcome } from './signals/types';

/**
 * The catch-rate fixes of 2026-11-08 (spec 5.5 "Catch-rate fixes", 5.6 hard rules), after the 70-scam eval caught
 * 34 of 54 online fake shops. General rules only; the domains below are .example stand-ins unless a real source's
 * address is the point of the test.
 */

const f = (kind: WebFinding['kind'], sourceUrl: string): WebFinding => ({ kind, sourceUrl, sourceTitle: 't', note: { en: 'n', fr: 'n' } });
const clean: ScanFacts = { domainAgeDays: 2000, validHttps: true, priceBelowPeersPct: null, threatHit: false, kernelOk: true, reputationChecked: true };
const outcomes = (over: Partial<Record<SignalId, SignalStatus>> = {}): SignalOutcome[] => SIGNAL_IDS.map((id) => ({ id, status: over[id] ?? 'pass', evidence: ['x'] }));

describe('price search: "not checked" says what really happened', () => {
  const product = { name: 'Kali Invader 2.0 Full Face Helmet', price: 119, currency: 'EUR', source: 'json-ld' as const };
  const research: never[] = [];
  const web = (offers: Awaited<ReturnType<WebResearcher['prices']>>['offers']): WebResearcher => ({ reputation: vi.fn(), prices: vi.fn(async () => ({ offers, usage: null })) });

  it('both searches ran and found too few offers of the same item → "not enough stores", never "right now"', async () => {
    const r = await pastedLinkPrice(product, 'https://shop.example/', { findOffers: async () => [], researcher: web([]), research });
    expect(r.outcome.status).toBe('unavailable');
    expect(r.outcome.evidence[0]).toMatch(/^Not enough other trustworthy stores sell exactly/);
  });
  it('no price search set up → says so', async () => {
    const r = await pastedLinkPrice(product, 'https://shop.example/', { findOffers: undefined, researcher: null, research });
    expect(r.outcome.evidence[0]).toBe(`Couldn't search other stores for "${product.name}" (no price search is set up), so its price wasn't compared.`);
  });
  it('a search that failed → says it failed', async () => {
    const r = await pastedLinkPrice(product, 'https://shop.example/', { findOffers: async () => null, researcher: web(null), research });
    expect(r.outcome.evidence[0]).toBe(`Couldn't search other stores for "${product.name}" (the price search failed), so its price wasn't compared.`);
  });
  it('the product search (Channel3) is used when it has 3+ offers of the same item', async () => {
    const offers = ['a', 'b', 'c'].map((s) => ({ title: product.name, price: 300, currency: 'EUR', storeUrl: `https://${s}.example/p` }));
    const r = await pastedLinkPrice(product, 'https://shop.example/', { findOffers: async () => offers, researcher: null, research });
    expect(r.outcome.status).toBe('fail'); // 119 vs 300: 60% below
    expect(r.outcome.evidence.at(-1)).toMatch(/found with a product search \(Channel3\)/);
  });
  it('the web price prompt always searches (15 of 35 eval calls had answered without a search)', () => {
    expect(PRICE_SYSTEM_PROMPT).toMatch(/Always search before you answer, at least once/);
  });
});

describe('what the web says: points only for strong evidence', () => {
  it('recognized authority sources, by address (never by what the model calls them)', () => {
    expect(authoritySource('https://www.watchlist-internet.at/liste-betruegerischer-shops/shop/x')).toBe('Watchlist Internet');
    expect(authoritySource('https://www.verbraucherzentrale-niedersachsen.de/node/1')).toBe('Verbraucherzentrale');
    expect(authoritySource('https://www.verbraucherzentrale.de/wissen/x')).toBe('Verbraucherzentrale');
    expect(authoritySource('https://warnung.fakeshop-finder.de/x')).toBe('Fakeshop-Finder (Verbraucherzentrale)');
    expect(authoritySource('https://www.bbb.org/scamtracker/lookupscam/1')).toBe('BBB Scam Tracker');
    expect(authoritySource('https://www.bbb.org/us/ca/x/profile/shop')).toBeNull(); // a BBB business profile isn't a warning
    expect(authoritySource('https://www.scamwatch.gov.au/x')).toBe('Scamwatch (ACCC)');
    expect(authoritySource('https://www.actionfraud.police.uk/x')).toBe('Action Fraud');
    expect(authoritySource('https://www.scamadviser.com/check-website/x')).toBeNull(); // automated score
    expect(authoritySource('https://malwaretips.com/blogs/x')).toBeNull();
    expect(authoritySource('https://watchlist-internet.at.evil.example/x')).toBeNull();
  });

  it('authority warning → strength "authority"; scam reports from 2+ sites → "reports"; anything else → none', () => {
    expect(webEvidenceStrength([f('warning_list', 'https://www.watchlist-internet.at/shop/x')])).toEqual({ strength: 'authority', source: 'Watchlist Internet' });
    expect(webEvidenceStrength([f('scam_report', 'https://a.example/x'), f('scam_report', 'https://b.example/y')]).strength).toBe('reports');
    expect(webEvidenceStrength([f('scam_report', 'https://a.example/x'), f('scam_report', 'https://a.example/y')]).strength).toBeNull(); // one site twice
    // Best Buy / John Lewis: complaint reviews alone never count.
    expect(webEvidenceStrength([f('complaint', 'https://a.example/x'), f('complaint', 'https://b.example/x'), f('complaint', 'https://c.example/x')]).strength).toBeNull();
    // An authority site's page that only mentions the shop neutrally doesn't count.
    expect(webEvidenceStrength([f('neutral', 'https://www.watchlist-internet.at/news/x')]).strength).toBeNull();
    expect(reputationStatus([f('complaint', 'https://a.example/x'), f('complaint', 'https://b.example/x')])).toBe('warn');
  });

  it('authority → BLOCK on its own (HOLD for a Tranco top-100k site); 2+ sites → HOLD; the cutoffs stay', () => {
    expect(WEB_POINTS).toEqual({ authority: 65, reports: 30 });
    expect(webPoints('authority', null)).toBe(65);
    expect(webPoints('authority', 4200)).toBe(30);
    expect(webPoints('reports', null)).toBe(30);
    expect(webPoints(null, null)).toBe(0);

    const a = score(outcomes(), { ...clean, webStrength: 'authority' });
    expect(a.score).toBe(65);
    expect(a.verdict).toBe('BLOCK');
    expect(a.hardRulesTriggered).toEqual(['authority_warning']);

    const known = score(outcomes(), { ...clean, webStrength: 'authority', wellKnownRank: 4200 });
    expect(known.verdict).toBe('HOLD');

    const rep = score(outcomes(), { ...clean, webStrength: 'reports' });
    expect(rep.score).toBe(30);
    expect(rep.verdict).toBe('HOLD');
    expect(rep.hardRulesTriggered).toEqual(['scam_reports']);

    expect(score(outcomes(), { ...clean, webStrength: null }).verdict).toBe('SAFE');
  });
});

describe('young domain + weak page → at least HOLD', () => {
  it('under 180 days with AI risk ≥ 30, or the AI reporting nobody named behind the shop', () => {
    expect(hardRules({ ...clean, domainAgeDays: 62, aiRisk: 38 }).map((r) => r.rule)).toEqual(['young_domain_weak_page']);
    expect(hardRules({ ...clean, domainAgeDays: 136, aiRisk: 20, aiMissingIdentity: true }).map((r) => r.rule)).toEqual(['young_domain_weak_page']);
    expect(score(outcomes({ domain_age: 'warn', ai_page: 'warn' }), { ...clean, domainAgeDays: 62, aiRisk: 38 }).verdict).toBe('HOLD');
  });
  it('not for an older domain (funstasy.at: AI 45, domain from 2024), a clean young page, or an unknown age', () => {
    expect(hardRules({ ...clean, domainAgeDays: 740, aiRisk: 45 })).toEqual([]);
    expect(hardRules({ ...clean, domainAgeDays: 179, aiRisk: 29 })).toEqual([]);
    expect(hardRules({ ...clean, domainAgeDays: 180, aiRisk: 45 })).toEqual([]);
    expect(hardRules({ ...clean, domainAgeDays: null, aiRisk: 45, aiMissingIdentity: true })).toEqual([]);
  });
});

describe('sent away to an unrelated site → couldn\'t verify', () => {
  it('any unrelated site, not only search engines', () => {
    expect(detectSentAway('https://gruen-shop.example/', 'https://angeltarot.example/articles/x')?.kind).toBe('sent_away');
    expect(detectSentAway('https://pottery-uk.example/', 'https://closingsale.example/')?.detail).toBe("This shop sent our check to closingsale.example instead of showing its shop. Real shops don't hide their pages.");
  });
  it('the shop\'s own name, platforms, checkouts, payments and CDNs are fine', () => {
    expect(detectSentAway('https://werksraeder-24.example/', 'https://www.werksraeder.example/')).toBeNull();
    expect(detectSentAway('https://brand.de/', 'https://www.brand.co.uk/')).toBeNull();
    expect(detectSentAway('https://brand.example/', 'https://brand-store.myshopify.com/')).toBeNull();
    expect(detectSentAway('https://brand.example/', 'https://www.paypal.com/checkoutnow?token=x')).toBeNull();
    expect(detectSentAway('https://brand.example/', 'https://checkout.stripe.com/c/pay/x')).toBeNull();
    expect(detectSentAway('https://brand.example/', 'https://pay.klarna.com/x')).toBeNull();
    expect(detectSentAway('https://brand.example/', 'https://x.cloudfront.net/x')).toBeNull();
    expect(sameShopName('galeria-kaufhof', 'galeria')).toBe(true);
    expect(sameShopName('abc', 'abcd')).toBe(false); // too short to be the same name
  });
  it('a pasted short link or ad/affiliate link ends on the shop itself, which is what gets judged', () => {
    expect(detectSentAway('https://bit.ly/3abc', 'https://www.shop.example/p')).toBeNull();
    expect(detectSentAway('https://www.awin1.com/cread.php?x', 'https://www.shop.example/p')).toBeNull();
    expect(detectSentAway('https://go.partner.example/r/1', 'https://www.shop.example/p')).toBeNull();
  });
  it('a search engine is still sent away, even when it is also a "platform" name', () => {
    expect(detectSentAway('https://fake.example/', 'https://www.google.com/')?.kind).toBe('sent_away');
  });
});

describe('domain age fallback: first certificate (crt.sh), labelled "first seen"', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const bootstrap = { services: [[['com'], ['https://rdap.example/']]] };
  function fakeFetch(crt: () => Promise<Response>) {
    return vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      if (u.startsWith('https://data.iana.org/')) return json(bootstrap);
      if (u.startsWith(CRT_SH.url)) return crt();
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;
  }

  it('parses the earliest certificate; no certificates or a result at the row cap → none', () => {
    expect(parseCrtSh([{ not_before: '2026-09-13T08:00:00' }, { not_before: '2026-10-01T00:00:00' }])).toEqual({ first: new Date('2026-09-13T08:00:00Z') });
    expect(parseCrtSh([])).toEqual({ first: null, why: 'no certificates found' });
    expect(parseCrtSh(Array.from({ length: CRT_SH.rowCap }, () => ({ not_before: '2026-01-01T00:00:00' })))).toEqual({ first: null, why: 'too many certificates to tell' });
    expect(parseCrtSh({ error: 'x' })).toEqual({ first: null, why: 'unexpected answer' });
  });

  it('a .de shop (no RDAP server) gets its first certificate as the age: "first seen", never "registered"', async () => {
    const fetchImpl = fakeFetch(async () => json([{ not_before: '2026-07-19T10:00:00' }]));
    const r = await domainAgeSignal(domainInfo('https://kueche-shop-1.de/'), now, fetchImpl);
    expect(r.ageDays).toBe(112);
    expect(r.outcome.status).toBe('warn');
    expect(r.outcome.evidence[0]).toBe("Couldn't look up the registration of kueche-shop-1.de (no RDAP server listed for .de).");
    expect(r.outcome.evidence[1]).toMatch(/^kueche-shop-1\.de was first seen on 2026-07-19 \(about 4 months ago\): its first certificate in the public certificate logs \(crt\.sh\)\. This is not the registration date/);
    expect(r.outcome.evidence.join(' ')).not.toMatch(/registered on/);
  });

  it('crt.sh down, slow or empty → not checked, said plainly; failures are cached only briefly', async () => {
    const down = await domainAgeSignal(domainInfo('https://kueche-shop-2.de/'), now, fakeFetch(async () => new Response('bad gateway', { status: 502 })));
    expect(down.ageDays).toBeNull();
    expect(down.outcome.status).toBe('unavailable');
    expect(down.outcome.evidence[1]).toBe('No first certificate date either (crt.sh HTTP 502).');
    const slow = await domainAgeSignal(domainInfo('https://kueche-shop-3.de/'), now, fakeFetch(async () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))));
    expect(slow.outcome.evidence[1]).toBe('No first certificate date either (crt.sh took too long).');
  });

  it('well-known sites and shared hosting skip it; it can be turned off', async () => {
    const crt = vi.fn(async () => json([{ not_before: '2026-10-01T00:00:00' }]));
    await domainAgeSignal(domainInfo('https://bigshop-4.de/'), now, fakeFetch(crt), { wellKnown: true });
    await domainAgeSignal(domainInfo('https://store.onrender.com/'), now, fakeFetch(crt));
    await domainAgeSignal(domainInfo('https://kueche-shop-5.de/'), now, fakeFetch(crt), { firstSeen: false });
    expect(crt).not.toHaveBeenCalled();
  });
});
