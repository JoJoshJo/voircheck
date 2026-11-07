import { describe, expect, it } from 'vitest';
import { DICTS } from './i18n';

// Copy pass: the extend-hold control drops the "(reauthorize)" jargon
// parenthetical. The plain action stays; "once, from day 4" lives in the note.
describe('Pay copy', () => {
  it.each(['en', 'fr'] as const)('extend-hold label has no jargon parenthetical (%s)', (lang) => {
    const p = DICTS[lang].pay;
    expect(p.reauthorize).not.toMatch(/[()]/);
    expect(p.reauthorize).toBe(lang === 'en' ? 'Extend the hold' : 'Prolonger le blocage');
  });
});
