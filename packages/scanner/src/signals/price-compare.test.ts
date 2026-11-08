import { describe, expect, it } from 'vitest';
import { SX740_OFFERS } from '../fixtures/hensaro-2026-11-07';
import { comparablePrices, sameProductTitle } from './price';

const NAME = 'Canon PowerShot SX740 HS Digital Camera (Black)';

describe('same product, other stores (pasted-link price check)', () => {
  it('matches the same model, not a neighbour model or an accessory for it', () => {
    expect(sameProductTitle(NAME, 'Canon - PowerShot SX740 HS 20.3-Megapixel Digital Camera - Black')).toBe(true);
    expect(sameProductTitle(NAME, 'Canon PowerShot SX720 HS Digital Camera')).toBe(false);
    expect(sameProductTitle(NAME, 'Case for Canon PowerShot SX740 HS')).toBe(false);
    expect(sameProductTitle(NAME, 'Sony Cyber-shot RX100')).toBe(false);
  });
  it('one price per store, never this store or a blocked store, same currency only', () => {
    const r = comparablePrices({ name: NAME, currency: 'USD', storeUrl: 'https://hensaro.com/products/x', offers: [...SX740_OFFERS, { title: NAME, price: 600, currency: 'EUR', storeUrl: 'https://euro.example/' }, { title: NAME, price: 640, currency: 'USD', storeUrl: 'https://www.bhphotovideo.com/other' }] });
    expect(r.prices.sort((a, b) => a - b)).toEqual([629, 640, 679.99, 699.99]);
    expect(r.excludedBlocked).toBe(1);
  });
});
