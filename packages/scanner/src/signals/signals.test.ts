import { describe, expect, it } from 'vitest';
import { domainInfo } from '../domain';
import { distinctiveSimilarity, evaluateClone, lookalike, skeleton, textShingles, textSimilarity } from './clone';
import { evaluateDomainAge, parseRdap } from './domain-age';
import { evaluatePrice, findPriceNear } from './price';
import { evaluateSsl } from './ssl';
import { evaluateThreatMatches } from './threat-list';

const NOW = new Date('2026-10-28T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('price signal', () => {
  it('finds the price right after the item title', () => {
    expect(findPriceNear('Shop\nZephlet Buds\nClear calls\n$23.00\nNimbair Purifier\n$49.00', 'Zephlet Buds')).toBe(23);
    expect(findPriceNear('Tickwell Smartwatch $1,149.50', 'tickwell smartwatch')).toBe(1149.5);
    expect(findPriceNear('No such item here $10', 'Zephlet Buds')).toBeNull();
  });

  it.each([
    [23, [59, 59], 'fail'], // Velbrook-Outlet: 61% below
    [35.3, [59], 'fail'], // 40.2% below
    [35.4, [59], 'warn'], // exactly 40% → warn (rule is "more than")
    [44, [59, 59], 'warn'], // Nyuie Clearance: 25% below
    [47.2, [59], 'pass'], // exactly 20% → pass (rule is "more than")
    [56, [59, 59], 'pass'], // 0ndaya: ~5% below must NOT fire
    [70, [59], 'pass'], // above peers
  ])('price %f vs %j → %s', (price, peers, status) => {
    expect(evaluatePrice({ price, title: 'Zephlet Buds', peerPrices: peers }).outcome.status).toBe(status);
  });

  it('uses the peer median and reports the percentage', () => {
    const r = evaluatePrice({ price: 50, title: 'X', peerPrices: [100, 40, 120] });
    expect(r.belowPct).toBe(50);
    expect(r.outcome.evidence.join(' ')).toContain('50% below');
  });

  it('is unavailable without a price or peers', () => {
    expect(evaluatePrice({ price: null, title: 'X', peerPrices: [10] }).outcome.status).toBe('unavailable');
    expect(evaluatePrice({ price: 10, title: 'X', peerPrices: [] }).outcome.status).toBe('unavailable');
  });
});

describe('lookalike detection', () => {
  it('0ndaya vs ondaya: zero-for-O homoglyph, 0ndaya is the copy', () => {
    expect(skeleton('0ndaya')).toBe('ondaya');
    expect(lookalike('0ndaya', 'ondaya')).toMatchObject({ lookalike: true, derivative: 'a' });
    expect(lookalike('Ondaya Home', '0ndaya Home')).toMatchObject({ lookalike: true, derivative: 'b' });
  });

  it('velbrook-outlet vs velbrook: extra hyphenated word, outlet is the copy', () => {
    expect(lookalike('velbrook-outlet', 'velbrook')).toMatchObject({ lookalike: true, derivative: 'a' });
    expect(lookalike('Velbrook-Outlet Deals', 'Velbrook Supply')).toMatchObject({ lookalike: true, derivative: 'a' });
    expect(lookalike('Velbrook Supply', 'Velbrook-Outlet Deals')).toMatchObject({ lookalike: true, derivative: 'b' });
  });

  it('Nyuie Market Clearance adds a word to Nyuie Market', () => {
    expect(lookalike('Nyuie Market Clearance', 'Nyuie Market')).toMatchObject({ lookalike: true, derivative: 'a' });
    expect(lookalike('Nyuie Market Clearance', 'Nyuie Market').reason).toContain('"clearance"');
  });

  it('catches 1-for-l, Cyrillic letters, hyphen tricks and small typos', () => {
    expect(lookalike('ve1brook', 'velbrook')).toMatchObject({ lookalike: true, derivative: 'a' });
    expect(lookalike('vеlbrook', 'velbrook')).toMatchObject({ lookalike: true, derivative: 'a' }); // Cyrillic е
    expect(lookalike('velbrook', 'vel-brook').lookalike).toBe(true);
    expect(lookalike('velbrok', 'velbrook')).toMatchObject({ lookalike: true, derivative: null });
  });

  it('does not flag unrelated or identical names', () => {
    expect(lookalike('Ondaya Home', 'Nyuie Market').lookalike).toBe(false);
    expect(lookalike('Velbrook Supply', 'Ondaya Home').lookalike).toBe(false);
    expect(lookalike('Ondaya Home', 'Velbrook Home').lookalike).toBe(false); // "home" is generic, not a brand
    expect(lookalike('Velbrook Supply', 'velbrook supply').lookalike).toBe(false);
  });
});

describe('page similarity', () => {
  const original = 'Welcome to Velbrook Supply. We test every product ourselves and ship from our own warehouse in Ohio. Returns are free for thirty days on all orders.';
  const copy = original.replaceAll('Velbrook Supply', 'Velbrook-Outlet Deals');
  const other = 'Ondaya Home sells calm, durable things for the house. Our team answers every email within one business day and ships worldwide.';

  it('a renamed copy scores ~1, unrelated text ~0', () => {
    expect(textSimilarity(original, copy, ['Velbrook Supply', 'Velbrook-Outlet Deals'])).toBeGreaterThan(0.9);
    expect(textSimilarity(original, other)).toBeLessThan(0.1);
  });

  it('strips longer store names first, so similarity is symmetric', () => {
    const a = 'Nyuie Market Clearance sells last units. Every order ships within two days from our Lomé warehouse.';
    const b = 'Nyuie Market sells last units. Every order ships within two days from our Lomé warehouse.';
    const names = ['Nyuie Market', 'Nyuie Market Clearance'];
    expect(textSimilarity(a, b, names)).toBe(textSimilarity(b, a, [...names].reverse()));
    expect(textSimilarity(a, b, names)).toBe(1);
  });

  it('ignores text every store shares (catalog copy) once a baseline peer is known', () => {
    const catalog = 'Zephlet Buds clear calls all day battery soft silicone tips charging case included in the box.';
    const ownAbout = 'We started in a garage in Ohio in 2019 and still pack every order ourselves by hand.';
    const otherAbout = 'Ondaya Home began as a market stall in Accra selling calm durable things for the house.';
    const legit = textShingles(`${catalog} ${ownAbout}`);
    const clone = textShingles(`${catalog} ${ownAbout} Excellent!!! Amazing quality super fast shipping best purchase this year`);
    const other = textShingles(`${catalog} ${otherAbout}`);
    expect(distinctiveSimilarity(clone, legit, [other])).toBeGreaterThan(0.4);
    expect(distinctiveSimilarity(other, legit, [clone])).toBe(0);
  });

  const page = (text: string) => ({ visibleText: text, structure: ['body', 'div', 'header', 'a', 'nav', 'a', 'main', 'h1', 'p'] });

  it('fail when this store borrows a name AND copies the page; the original passes', () => {
    const scam = { url: 'https://velbrook-outlet.shop/', siteName: 'Velbrook-Outlet Deals', page: page(copy) };
    const legit = { url: 'https://velbrook.com/', siteName: 'Velbrook Supply', page: page(original) };
    expect(evaluateClone(scam, [legit]).status).toBe('fail');
    const r = evaluateClone(legit, [scam]);
    expect(r.status).toBe('pass');
    expect(r.evidence.join(' ')).toContain('looks like the original');
  });

  it('warn on lookalike domain alone (no page data)', () => {
    const r = evaluateClone({ url: 'https://0ndaya.com/', siteName: null }, [{ url: 'https://ondaya.com/', siteName: null }]);
    expect(r.status).toBe('warn');
  });

  it('notes a shared hosting domain and still compares names', () => {
    const r = evaluateClone(
      { url: 'https://stores.onrender.com/s/0ndaya-home', siteName: '0ndaya Home' },
      [{ url: 'https://stores.onrender.com/s/ondaya-home', siteName: 'Ondaya Home' }],
    );
    expect(r.status).toBe('warn');
    expect(r.evidence[0]).toContain('shares its web address');
  });

  it('unavailable without peers', () => {
    expect(evaluateClone({ url: 'https://a.com/', siteName: 'A' }, []).status).toBe('unavailable');
  });
});

describe('domain age signal', () => {
  const info = domainInfo('https://velbrook-outlet.shop/');
  it.each([
    [3, 'fail'],
    [29, 'fail'],
    [30, 'warn'],
    [179, 'warn'],
    [180, 'pass'],
  ])('%i days → %s', (days, status) => {
    const r = evaluateDomainAge(info, { registeredAt: daysAgo(days), registrar: null }, NOW);
    expect(r.outcome.status).toBe(status);
    expect(r.ageDays).toBe(days);
  });

  it('says honestly that a hosting subdomain inherits the provider domain age', () => {
    const r = evaluateDomainAge(domainInfo('https://voircheck-stores.onrender.com/s/x'), { registeredAt: daysAgo(3000), registrar: null }, NOW);
    expect(r.outcome.status).toBe('pass');
    expect(r.outcome.evidence.join(' ')).toContain("the age shown is the provider's domain");
  });

  it('parses RDAP registration date and registrar', () => {
    const facts = parseRdap({
      events: [{ eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' }, { eventAction: 'registration', eventDate: '2018-03-04T00:00:00Z' }],
      entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Example Registrar, Inc.']]] }],
    });
    expect(facts.registeredAt?.toISOString()).toBe('2018-03-04T00:00:00.000Z');
    expect(facts.registrar).toBe('Example Registrar, Inc.');
  });
});

describe('ssl & redirects signal', () => {
  const tls = { valid: true, issuer: 'Google Trust Services', validFrom: daysAgo(10) };
  it('pass on https with a valid cert and no cross-domain redirect', () => {
    const r = evaluateSsl({ url: 'https://a.com/', navigation: { finalUrl: 'https://a.com/', redirectChain: ['https://a.com/'] }, tls, now: NOW });
    expect(r).toMatchObject({ validHttps: true, outcome: { status: 'pass' } });
  });
  it('fail when the page ends on http', () => {
    const r = evaluateSsl({ url: 'http://a.com/', navigation: { finalUrl: 'http://a.com/', redirectChain: ['http://a.com/'] }, tls: null, now: NOW });
    expect(r).toMatchObject({ validHttps: false, outcome: { status: 'fail' } });
  });
  it('fail on an invalid certificate', () => {
    const r = evaluateSsl({ url: 'https://a.com/', navigation: null, tls: { valid: false, error: 'self-signed certificate' }, now: NOW });
    expect(r).toMatchObject({ validHttps: false, outcome: { status: 'fail' } });
  });
  it('warn on a cross-domain redirect', () => {
    const r = evaluateSsl({ url: 'https://a.com/', navigation: { finalUrl: 'https://b.shop/', redirectChain: ['https://a.com/', 'https://b.shop/'] }, tls, now: NOW });
    expect(r.outcome.status).toBe('warn');
    expect(r.outcome.evidence.join(' ')).toContain('a.com → b.shop');
  });
});

describe('threat list signal', () => {
  it('pass with no matches, fail with a match', () => {
    expect(evaluateThreatMatches(['https://a.com/'], []).hit).toBe(false);
    const r = evaluateThreatMatches(['https://a.com/'], [{ threatType: 'SOCIAL_ENGINEERING', threat: { url: 'https://a.com/' } }]);
    expect(r).toMatchObject({ hit: true, outcome: { status: 'fail' } });
    expect(r.outcome.evidence[0]).toContain('phishing');
  });
});
