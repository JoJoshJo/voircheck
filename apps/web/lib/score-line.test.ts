import { describe, expect, it } from 'vitest';
import { DICTS } from './i18n';
import { scoreLine } from './score-line';

describe('scoreLine', () => {
  it('shows the score normally', () => {
    expect(scoreLine(DICTS.en, { score: 45, cantVerify: null })).toBe('Risk score: 45/100');
  });
  it('shows why when the HOLD is only "couldn’t verify", in both languages', () => {
    expect(scoreLine(DICTS.en, { score: 0, cantVerify: { reason: 'bot_check', httpStatus: 403 } })).toBe('Couldn’t verify — blocked by a bot check (HTTP 403)');
    expect(scoreLine(DICTS.fr, { score: 0, cantVerify: { reason: 'visit_failed' } })).toBe('Vérification impossible — la page ne s’est pas chargée');
  });
});
