import { describe, expect, it } from 'vitest';
import { formatWhen, splitWhen } from './when';

const AT = '2026-11-03T16:25:00Z'; // 11:25 in New York (EST)

describe('times always name their zone', () => {
  it('UTC on the server, labelled', () => {
    expect(formatWhen(AT, 'en', 'long', 'UTC')).toBe('November 3, 2026, 4:25 PM UTC');
    expect(formatWhen(AT, 'fr', 'medium', 'UTC')).toBe('3 nov. 2026 à 16:25 UTC');
  });
  it("the viewer's own zone in the browser, labelled too", () => {
    expect(formatWhen(AT, 'en', 'medium', 'America/New_York')).toBe('Nov 3, 2026, 11:25 AM EST');
    expect(formatWhen(AT, 'fr', 'long', 'America/New_York')).toMatch(/^3 novembre 2026 à 11:25 UTC−5$/);
  });
  it('splits a "{when}" template around the time', () => {
    expect(splitWhen('Recorded {when}')).toEqual(['Recorded ', '']);
    expect(splitWhen('no time')).toEqual(['no time', '']);
  });
});
