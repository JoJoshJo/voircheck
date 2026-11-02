import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { domainInfo } from '../domain';
import { trancoLookup, trancoRanks } from '../reputation';
import { brandIndex, brandInDomain, brandOf, withBrandHit, type Brand, type BrandLookup } from './brand-domain';

const fake = (...brands: Array<[string, number]>): BrandLookup => {
  const m = new Map<string, Brand>(brands.map(([domain, rank]) => [domain.split('.')[0]!, { label: domain.split('.')[0]!, domain, rank }]));
  return (l) => m.get(l) ?? null;
};
const brands = fake(['rimowa.com', 56_024], ['nike.com', 90], ['zalando.de', 5_097]);

describe('brand in domain: matching', () => {
  it.each([
    ['rimowa-store', 'rimowa'],
    ['rimowastore', 'rimowa'],
    ['shop-rimowa-de', 'rimowa'],
    ['nike-outlet', 'nike'],
    ['zalando-sale', 'zalando'],
  ])('%s → %s', (label, brand) => expect(brandOf(label, brands)?.label).toBe(brand));

  it.each([
    ['rimowa', "the brand's own site (any country)"],
    ['kinderschatz', 'brand plus a non-shop word'],
    ['rimowa-reisekoffer', 'brand plus a non-shop word'],
    ['nike-adidas-store', 'two names left'],
    ['nikelodeon', 'brand inside a longer word'],
    ['store', 'only shop words'],
  ])('%s → no match (%s)', (label) => expect(brandOf(label, brands)).toBeNull());

  it('skips a store that is itself well known, and works without a lookup', () => {
    expect(brandInDomain('https://rimowa-store.de/', brands, 40_000)).toBeNull();
    expect(brandInDomain('https://rimowa-store.de/', null, null)).toBeNull();
  });

  it('evidence names the brand and its site', () => {
    expect(brandInDomain('https://www.rimowa-store.de/de/koffer', brands, null)?.evidence).toBe(
      `Uses the brand name "rimowa" but isn't rimowa's site (rimowa.com, #56,024 in the Tranco top-sites list). Real resellers exist, so this alone is a warning, not proof.`,
    );
  });

  it('index: top-N only, ≥4 letters, never a stopword, best rank wins', () => {
    const ranks = new Map([['apple.com', 5], ['ebay.com', 30], ['bmw.de', 40], ['zalando.de', 900], ['zalando.com', 800], ['rimowa.com', 56_024]]);
    const idx = brandIndex(ranks, new Set(['apple']), 10_000);
    expect([...idx.keys()].sort()).toEqual(['ebay', 'zalando']);
    expect(idx.get('zalando')?.domain).toBe('zalando.com');
  });
});

describe('brand in domain: clone outcome', () => {
  const hit = brandInDomain('https://rimowa-store.de/', brands, null)!;
  it('no peers (unavailable) → warn with the brand evidence only', () => {
    expect(withBrandHit({ id: 'clone', status: 'unavailable', evidence: ['No other stores to compare with.'] }, hit)).toEqual({ id: 'clone', status: 'warn', evidence: [hit.evidence] });
  });
  it('raises pass to warn, keeps fail, adds evidence first', () => {
    expect(withBrandHit({ id: 'clone', status: 'pass', evidence: ['vs X: no lookalike.'] }, hit)).toMatchObject({ status: 'warn', evidence: [hit.evidence, 'vs X: no lookalike.'] });
    expect(withBrandHit({ id: 'clone', status: 'fail', evidence: [] }, hit).status).toBe('fail');
    expect(withBrandHit({ id: 'clone', status: 'pass', evidence: [] }, null).status).toBe('pass');
  });
});

describe('brand in domain: pinned Tranco list + stopwords', () => {
  const ranks = trancoRanks()!;
  const stop = new Set(readFileSync(join(__dirname, '..', '..', 'data', 'brand-stopwords.txt'), 'utf8').split('\n').filter(Boolean));
  const at = (top: number): BrandLookup => {
    const idx = brandIndex(ranks, stop, top);
    return (l) => idx.get(l) ?? null;
  };
  const check = (url: string, lookup: BrandLookup) => {
    const reg = domainInfo(url).registrable;
    return brandInDomain(url, lookup, reg ? trancoLookup(reg) : null);
  };
  const top10k = at(10_000);
  const top100k = at(100_000);

  // The tune split's legit stores, incl. resellers of big brands (bikes, diving, knives, tea).
  it.each(['https://www.rei.com/', 'https://www.johnlewis.com/', 'https://www.currys.co.uk/', 'https://bettenreiter.at/', 'https://bikepalast.com/', 'https://messerkoenig.at/', 'https://tee-shop.at/', 'https://tauchversand.com/', 'https://dieroester.at/', 'https://naehprinz.at/'])(
    'legit %s: no hit at top 10k or 100k',
    (url) => {
      expect(check(url, top10k)).toBeNull();
      expect(check(url, top100k)).toBeNull();
    },
  );

  it('ordinary words are never brands', () => {
    for (const w of ['apple', 'booking', 'kinder', 'online', 'hotels']) expect(stop.has(w)).toBe(true);
    expect(check('https://kinderschatz.com/', top100k)).toBeNull();
    expect(check('https://booking-deals.com/', top100k)).toBeNull();
  });

  it('rimowa-store.de: rimowa.com is #56k, so it needs the top-100k list', () => {
    expect(check('https://rimowa-store.de/', top10k)).toBeNull();
    expect(check('https://rimowa-store.de/', top100k)?.brand.domain).toBe('rimowa.com');
  });

  it('top-10k brands work: zalando-outlet.shop', () => {
    expect(check('https://zalando-outlet.shop/', top10k)?.brand.domain).toMatch(/^zalando\./);
  });
});
