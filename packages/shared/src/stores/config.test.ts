import { describe, expect, it } from 'vitest';
import { DEMO_STORES } from '../../../../db/src/demo-stores';
import { STORES, STORE_THEMES, TELL_IDS, storeSlugForHost, type TellId } from './index';

const tellsOn = (slug: string) => {
  const store = STORES.find((s) => s.slug === slug)!;
  return TELL_IDS.filter((t) => store.tells[t]);
};

describe('demo store config', () => {
  it('has exactly 6 stores', () => {
    expect(STORES).toHaveLength(6);
  });

  it('matches the db seed (slug, name, pair, role, theme)', () => {
    const fromConfig = STORES.map(({ slug, name, pair, role, theme }) => ({ slug, name, pair, role, theme }));
    const fromSeed = DEMO_STORES.map(({ slug, name, pair, role, theme }) => ({ slug, name, pair, role, theme }));
    expect(fromConfig).toEqual(fromSeed);
  });

  it('plants tells only where spec 5.8 says', () => {
    const expected: Record<string, TellId[]> = {
      'velbrook-supply': [],
      'velbrook-outlet-deals': [...TELL_IDS],
      'ondaya-home': [],
      '0ndaya-home': ['noContactInfo', 'brokenPolicies'],
      'nyuie-market': [],
      'nyuie-market-clearance': ['fakeScarcity'],
    };
    for (const [slug, tells] of Object.entries(expected)) expect(tellsOn(slug), slug).toEqual(tells);
  });

  it('plants the prompt injection on Velbrook-Outlet only', () => {
    expect(STORES.filter((s) => s.promptInjection).map((s) => s.slug)).toEqual(['velbrook-outlet-deals']);
  });

  it('prices: Velbrook-Outlet ~60% lower, 0ndaya only ~10% lower, Nyuie Clearance ~25% lower', () => {
    const discount = (clone: string, twin: string) => {
      const a = STORES.find((s) => s.slug === clone)!.products;
      const b = STORES.find((s) => s.slug === twin)!.products;
      return a.map((p, i) => 1 - p.price / b[i]!.price);
    };
    for (const d of discount('velbrook-outlet-deals', 'velbrook-supply')) expect(d).toBeGreaterThan(0.55);
    for (const d of discount('0ndaya-home', 'ondaya-home')) expect(d).toBeLessThan(0.15);
    for (const d of discount('nyuie-market-clearance', 'nyuie-market')) {
      expect(d).toBeGreaterThan(0.2);
      expect(d).toBeLessThan(0.3);
    }
  });

  it('clones copy their twin: same theme, same product copy', () => {
    for (const clone of STORES.filter((s) => s.cloneOf)) {
      const twin = STORES.find((s) => s.slug === clone.cloneOf)!;
      expect(STORE_THEMES[clone.theme]).toBe(STORE_THEMES[twin.theme]);
      expect(clone.products.map((p) => p.description)).toEqual(twin.products.map((p) => p.description));
    }
  });

  it('legit stores have full contact info; noContactInfo stores have no address or phone', () => {
    for (const s of STORES) {
      if (s.role === 'legit') expect(s.contact.address && s.contact.phone && /555-01\d\d/.test(s.contact.phone)).toBeTruthy();
      if (s.tells.noContactInfo) expect([s.contact.address, s.contact.phone]).toEqual([undefined, undefined]);
    }
  });

  it('host routing returns nothing until domains are configured', () => {
    expect(storeSlugForHost('localhost:3001')).toBeUndefined();
  });
});
