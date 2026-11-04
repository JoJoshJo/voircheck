import { describe, expect, it } from 'vitest';
import { DICTS } from './i18n';
import { plainVerdict } from './plain-verdict';

const sig = (price: string, other = 'pass') => [
  { id: 'domain_age', status: other },
  { id: 'price', status: price },
];

describe('plain verdict sentence', () => {
  it('SAFE: "no warning signs" only when nothing warned, "fair price" only when the price check passed', () => {
    const t = DICTS.en;
    expect(plainVerdict(t, { verdict: 'SAFE', signals: sig('pass') }).line).toBe('Looks safe to buy. No warning signs, fair price.');
    expect(plainVerdict(t, { verdict: 'SAFE', signals: sig('pass', 'warn') }).line).toBe('Looks safe to buy. Fair price.');
    expect(plainVerdict(t, { verdict: 'SAFE', signals: sig('unavailable') }).line).toBe('Looks safe to buy. No warning signs.');
    expect(plainVerdict(t, { verdict: 'SAFE', signals: sig('unavailable', 'warn') }).line).toBe('Looks safe to buy.');
  });

  it('HOLD asks; BLOCK refuses (EN + FR, "vous" wording)', () => {
    expect(plainVerdict(DICTS.en, { verdict: 'HOLD', signals: [] })).toEqual({ line: 'Something looks a bit off.', ask: 'Buy anyway, or see why?' });
    expect(plainVerdict(DICTS.en, { verdict: 'BLOCK', signals: [] }).line).toBe('Looks like a fake shop. I won’t pay this one.');
    expect(plainVerdict(DICTS.fr, { verdict: 'SAFE', signals: sig('pass') }).line).toBe('Ça semble sûr pour acheter. Aucun signal d’alerte, prix correct.');
    expect(plainVerdict(DICTS.fr, { verdict: 'BLOCK', signals: [] }).line).toBe('Ça ressemble à une fausse boutique. Je ne la paierai pas.');
  });

  it.each(['en', 'fr'] as const)('never states a result as a fact about a business (%s)', (lang) => {
    const lines = (['SAFE', 'HOLD', 'BLOCK'] as const).flatMap((verdict) => {
      const p = plainVerdict(DICTS[lang], { verdict, signals: sig('pass') });
      return [p.line, p.ask ?? ''];
    });
    for (const l of lines) expect(l).not.toMatch(/\b(is|are) (a )?(safe|real|fake|legit|scam)\b|\b(est|c’est) (une )?(fiable|sûre?|vraie|fausse|arnaque)\b/i);
  });
});
