import { describe, expect, it } from 'vitest';
import { parseAmount, productFromPage, type PageFacts } from './page-facts';

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({ ldJson: [], metaPrice: null, metaTitle: null, logoAlts: [], bannerText: '', ...over });

describe('product and price from the page', () => {
  it('JSON-LD Product first, from @graph, offers as a list, priceSpecification', () => {
    const graph = { '@graph': [{ '@type': 'WebPage' }, { '@type': ['Product'], name: ' Zephlet  Buds ', offers: [{ '@type': 'Offer', priceSpecification: { price: '59.00' }, priceCurrency: 'usd' }] }] };
    expect(productFromPage(facts({ ldJson: [JSON.stringify(graph)], metaPrice: { amount: '1', currency: 'EUR' }, metaTitle: 'x' }))).toEqual({ name: 'Zephlet Buds', price: 59, currency: 'USD', source: 'json-ld' });
  });
  it('a ProductGroup takes the first variant with a price', () => {
    const g = { '@type': 'ProductGroup', name: 'Tee', hasVariant: [{ '@type': 'Product', offers: { price: 19.5, priceCurrency: 'EUR' } }] };
    expect(productFromPage(facts({ ldJson: [JSON.stringify(g)] }))).toMatchObject({ name: 'Tee', price: 19.5, currency: 'EUR' });
  });
  it('then meta price tags with og:title (or the H1)', () => {
    expect(productFromPage(facts({ ldJson: ['{not json'], metaPrice: { amount: '1.299,00', currency: 'eur' }, metaTitle: 'Laptop X1' }))).toEqual({ name: 'Laptop X1', price: 1299, currency: 'EUR', source: 'meta' });
    expect(productFromPage(facts({ metaPrice: { amount: '77', currency: null } }), 'Camera')).toEqual({ name: 'Camera', price: 77, currency: null, source: 'meta' });
  });
  it('nothing usable → null (no product, no price, or no facts)', () => {
    expect(productFromPage(facts({ ldJson: [JSON.stringify({ '@type': 'Product', name: 'A', offers: { price: 'call us' } })] }))).toBeNull();
    expect(productFromPage(facts())).toBeNull();
    expect(productFromPage(null)).toBeNull();
  });
  it.each([
    ['77', 77],
    ['1,299.00', 1299],
    ['1.299,00', 1299],
    ['77,50', 77.5],
    ['$ 649.99', 649.99],
    ['0', null],
    ['free', null],
  ])('parseAmount(%s) = %s', (raw, want) => expect(parseAmount(raw)).toBe(want));
});
