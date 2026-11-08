import { describe, expect, it } from 'vitest';
import type { PageFacts } from '../page-facts';
import { retailerOnPage, withRetailerHit } from './brand-on-page';

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({ ldJson: [], metaPrice: null, metaTitle: null, logoAlts: [], bannerText: '', ...over });
const hit = (url: string, f: Partial<PageFacts>, siteName: string | null = null, title: string | null = null, wellKnownRank: number | null = null) =>
  retailerOnPage({ url, siteName, title, facts: facts(f), wellKnownRank });

describe('a big retailer named on someone else\'s shop', () => {
  it('Costco banner and logo on hensaro.com → hit, with the words', () => {
    const h = hit('https://hensaro.com/p/cam', { logoAlts: ['Costco Wholesale'], bannerText: 'Costco Wholesale | Member Exclusive' });
    expect(h?.retailer.name).toBe('Costco');
    expect(h?.where).toBe('logo');
    expect(h?.quote).toBe('Costco Wholesale');
  });
  it('the site name counts when it is the shop\'s own name, not the whole page title', () => {
    expect(hit('https://deals-hub.shop/', {}, 'Walmart', 'Canon camera – Walmart')?.retailer.name).toBe('Walmart');
    // No separator in the title: the "site name" is the product's name (Amazon makes Echo devices).
    expect(hit('https://gadgets.example/', {}, 'Amazon Echo Dot (5th Gen)', 'Amazon Echo Dot (5th Gen)')).toBeNull();
  });
  it('a product maker is not a retailer: Canon on a camera page is fine', () => {
    expect(hit('https://camera-corner.example/', { logoAlts: ['Canon'], bannerText: 'Canon cameras in stock' }, 'Camera Corner', 'SX740 – Camera Corner')).toBeNull();
  });
  it('a mention is not a claim: "also available on Amazon", "cheaper than Walmart"', () => {
    expect(hit('https://smallbrand.example/', { bannerText: 'Also available on Amazon | Cheaper than Walmart' })).toBeNull();
  });
  it('a payment logo is a service the shop uses, not its identity: "Amazon pay" (tauchversand.com, eval 2026-11-08)', () => {
    expect(hit('https://tauchversand.com/', { logoAlts: ['Amazon pay', 'Walmart Pay', 'PayPal'] })).toBeNull();
    expect(hit('https://shop.example/', { bannerText: 'Pay with Amazon Pay | Amazon Prime shipping' })).toBeNull();
    expect(hit('https://fake.example/', { logoAlts: ['Amazon pay', 'Amazon'] })?.quote).toBe('Amazon');
  });
  it('ordinary words stay ordinary: "hit your target" is not Target', () => {
    expect(hit('https://archery.example/', { bannerText: 'Hit your target this season' })).toBeNull();
    expect(hit('https://fake.example/', { logoAlts: ['Target'] })?.retailer.name).toBe('Target');
  });
  it('the retailer\'s own sites and well-known sites are never flagged', () => {
    expect(hit('https://www.costco.com/p/cam', { logoAlts: ['Costco Wholesale'] })).toBeNull();
    expect(hit('https://www.costco.co.uk/', { logoAlts: ['Costco'] })).toBeNull();
    expect(hit('https://pricetracker.example/', { logoAlts: ['Amazon price tracker'] }, null, null, 5_000)).toBeNull();
  });
  it('turns the clone check into a fail, keeping its earlier evidence unless it had none to give', () => {
    const h = hit('https://hensaro.com/', { logoAlts: ['Costco Wholesale'] });
    const out = withRetailerHit({ id: 'clone', status: 'unavailable', evidence: ['No other stores to compare with.'] }, h, 'https://hensaro.com/');
    expect(out.status).toBe('fail');
    expect(out.evidence).toEqual(['This page presents itself as Costco (logo: "Costco Wholesale"), but its address is hensaro.com, not Costco\'s. Fake shops often borrow a big store\'s name.']);
    expect(withRetailerHit({ id: 'clone', status: 'pass', evidence: ['x'] }, null, 'https://a.example/').status).toBe('pass');
  });
});
