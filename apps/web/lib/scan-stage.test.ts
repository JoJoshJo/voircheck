import { describe, expect, it } from 'vitest';
import { DICTS } from './i18n';
import { scanStage } from './scan-stage';

describe('check in progress', () => {
  it.each(['en', 'fr'] as const)('moves from the shop to the pages to the price to almost done as checks report (%s)', (lang) => {
    const s = DICTS[lang].stage;
    expect(scanStage(DICTS[lang], {})).toBe(s.visiting);
    expect(scanStage(DICTS[lang], { domain_age: 'pending' })).toBe(s.visiting);
    expect(scanStage(DICTS[lang], { domain_age: 'pass', ssl_redirects: 'pass' })).toBe(s.reading);
    expect(scanStage(DICTS[lang], { domain_age: 'pass', ssl_redirects: 'pass', threat_list: 'pass' })).toBe(s.price);
    expect(scanStage(DICTS[lang], { a: 'pass', b: 'pass', c: 'pass', d: 'warn', e: 'pass' })).toBe(s.almost);
  });
});
