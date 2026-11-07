import { describe, expect, it } from 'vitest';
import { DICTS } from './i18n';

// Copy pass: the How-it-works page uses the app's plain verdict words in the
// score bands and the attack table, drops "model"/"authorization"/"Agent
// Toolkit" jargon, says the agent asks first, and no longer ships the unrun
// holdout placeholder.
describe('How it works copy', () => {
  it.each(['en', 'fr'] as const)('score bands use plain verdict words (%s)', (lang) => {
    const h = DICTS[lang].how;
    if (lang === 'en') {
      expect(h.thresholds).toContain('Looks safe');
      expect(h.thresholds).toContain('A bit off (you decide)');
      expect(h.thresholds).toContain('Looks fake');
      expect(h.attackHold).toBe('A bit off (you decide)');
      expect(h.attacksMissed).toBe('Missed: Looks safe');
    } else {
      expect(h.thresholds).toContain('semble fiable');
      expect(h.thresholds).toContain('un doute (vous décidez)');
      expect(h.thresholds).toContain('semble faux');
      expect(h.attackHold).toBe('Un doute (vous décidez)');
      expect(h.attacksMissed).toBe('Manquée : semble fiable');
    }
    // No ALL-CAPS single-word verdict labels left in the bands.
    expect(h.thresholds).not.toMatch(/\b(SAFE|HOLD|BLOCK)\b/);
  });

  it.each(['en', 'fr'] as const)('no model/authorization/Agent Toolkit jargon; agent asks first; no holdout placeholder (%s)', (lang) => {
    const h = DICTS[lang].how as Record<string, string>;
    expect(h.moneyBody).not.toMatch(/Agent Toolkit/);
    expect(h.moneyBody).toContain('PayPal AI Toolkit');
    expect(h.moneyBody).not.toMatch(/authorization|autorisation PayPal/);
    expect(h.agentBody).not.toMatch(/prepares the order|prépare la commande/);
    expect(h.withoutTag).not.toMatch(/real model|vrai modèle/);
    expect('holdout' in h).toBe(false);
  });
});
