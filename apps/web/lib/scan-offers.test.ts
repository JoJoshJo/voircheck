import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ getDb: () => ({}) }));

const { findOffers } = await import('./scan-runner');
const { canonicalUrl } = await import('./scans');

const result = (storeUrl: string, price: number) => ({ source: 'channel3' as const, productId: 'p1', title: 'Canon PowerShot SX740 HS', price, compareAtPrice: null, currency: 'USD', storeName: storeUrl, storeDomain: storeUrl, storeUrl, productUrl: `${storeUrl}p`, imageUrl: null, availability: 'in_stock' as const, condition: 'new' as const });

describe('pasted-link price check: other stores from Channel3', () => {
  it('no Channel3 key → no comparison at all', () => {
    expect(findOffers('')).toBeUndefined();
  });

  it('maps each offer with that store\'s own latest verdict, looked up once per store', async () => {
    const search = vi.fn(async () => ({ status: 'ok' as const, results: [result('https://a.example/', 649), result('https://b.example/', 679), result('https://a.example/', 655)] }));
    const verdictFor = vi.fn(async (u: string) => (u === 'https://b.example/' ? ('BLOCK' as const) : undefined));
    const offers = await findOffers('key', search as never, verdictFor)!('Canon PowerShot SX740 HS');
    expect(search).toHaveBeenCalledWith('Canon PowerShot SX740 HS', 20, expect.objectContaining({ apiKey: 'key' }));
    expect(verdictFor).toHaveBeenCalledTimes(2);
    expect(offers).toEqual([
      { title: 'Canon PowerShot SX740 HS', price: 649, currency: 'USD', storeUrl: 'https://a.example/', verdict: undefined },
      { title: 'Canon PowerShot SX740 HS', price: 679, currency: 'USD', storeUrl: 'https://b.example/', verdict: 'BLOCK' },
      { title: 'Canon PowerShot SX740 HS', price: 655, currency: 'USD', storeUrl: 'https://a.example/', verdict: undefined },
    ]);
  });

  it('no results → no offers (not compared, says why); Channel3 down → null (not available right now)', async () => {
    expect(await findOffers('key', (async () => ({ status: 'no_results', query: 'x' })) as never, async () => undefined)!('x')).toEqual([]);
    expect(await findOffers('key', (async () => ({ status: 'unavailable', reason: 'down' })) as never, async () => undefined)!('x')).toBeNull();
  });
});

describe('scan cache key', () => {
  it('ad and click tracking never reaches the cache key or the stored URL', () => {
    expect(canonicalUrl('https://Hensaro.com/products/cam?variant=1&currency=USD&utm_source=google&gclid=abc&gad_source=1&stkn=x#top')).toBe('https://hensaro.com/products/cam?variant=1&currency=USD');
  });
});
