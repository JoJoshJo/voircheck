import { describe, expect, it } from 'vitest';
import { isTrackingParam, stripTracking } from './tracking';

describe('tracking parameters', () => {
  it('strips utm_*, gclid, gad_*, fbclid, stkn and other click ids; keeps what picks the product', () => {
    const u = 'https://shop.example/p/cam?variant=42&currency=USD&country=US&utm_source=google&utm_medium=cpc&gclid=abc&gad_source=1&gad_campaignid=9&fbclid=x&stkn=1&msclkid=2&srsltid=3#reviews';
    expect(stripTracking(u)).toBe('https://shop.example/p/cam?variant=42&currency=USD&country=US');
  });
  it('a link with only tracking ends with no query at all', () => {
    expect(stripTracking('https://shop.example/?utm_source=x&gclid=y')).toBe('https://shop.example/');
  });
  it('is case-insensitive and leaves look-alikes alone', () => {
    expect(isTrackingParam('UTM_Campaign')).toBe(true);
    expect(isTrackingParam('GCLID')).toBe(true);
    expect(isTrackingParam('utmost')).toBe(false);
    expect(isTrackingParam('gadget')).toBe(false);
  });
  it('unparseable input comes back unchanged', () => {
    expect(stripTracking('not a url')).toBe('not a url');
  });
});
