import { describe, expect, it } from 'vitest';
import { SIGNAL_IDS, type SignalId, type SignalStatus } from './schema';
import { hardRules, score, THRESHOLDS, verdictForScore, WEIGHTS } from './scoring';
import type { ScanFacts, SignalOutcome } from './signals/types';

const clean: ScanFacts = { domainAgeDays: 2000, validHttps: true, priceBelowPeersPct: 0, threatHit: false, kernelOk: true };

function outcomes(over: Partial<Record<SignalId, SignalStatus>> = {}): SignalOutcome[] {
  return SIGNAL_IDS.map((id) => ({ id, status: over[id] ?? (id === 'ai_page' ? 'unavailable' : 'pass'), evidence: ['x'] }));
}

describe('thresholds', () => {
  it.each([
    [0, 'SAFE'],
    [29, 'SAFE'],
    [30, 'HOLD'],
    [64, 'HOLD'],
    [65, 'BLOCK'],
    [100, 'BLOCK'],
  ] as const)('score %i → %s', (s, v) => expect(verdictForScore(s)).toBe(v));

  it('matches spec 5.6 (SAFE <30, BLOCK ≥65)', () => expect(THRESHOLDS).toEqual({ hold: 30, block: 65 }));
});

describe('weights', () => {
  it('"unavailable" is worth 0 points for every signal', () => {
    for (const id of SIGNAL_IDS) expect(WEIGHTS[id].unavailable).toBe(0);
  });

  it('every warn stays SAFE alone; every fail but domain_age reaches HOLD alone', () => {
    for (const id of SIGNAL_IDS) {
      expect(verdictForScore(WEIGHTS[id].warn)).toBe('SAFE');
      if (id !== 'domain_age') expect(verdictForScore(WEIGHTS[id].fail)).not.toBe('SAFE');
    }
    expect(verdictForScore(WEIGHTS.domain_age.fail)).toBe('SAFE');
  });

  it('sums points per signal and caps the score at 100', () => {
    const r = score(outcomes({ clone: 'fail', price: 'fail', domain_age: 'fail', ai_page: 'fail' }), clean);
    expect(r.signals.find((s) => s.id === 'clone')?.points).toBe(WEIGHTS.clone.fail);
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('BLOCK');
  });

  it('two strong fails (clone + price) reach BLOCK; clone + fresh domain reaches BLOCK', () => {
    expect(score(outcomes({ clone: 'fail', price: 'fail' }), clean).verdict).toBe('BLOCK');
    expect(score(outcomes({ clone: 'fail', domain_age: 'fail' }), clean).score).toBe(65);
  });
});

describe('hard rules', () => {
  it('threat-list hit → BLOCK even with score 0', () => {
    const r = score(outcomes(), { ...clean, threatHit: true });
    expect(r.score).toBe(0);
    expect(r.verdict).toBe('BLOCK');
    expect(r.hardRulesTriggered).toEqual(['threat_list_hit']);
  });

  it('no valid HTTPS → at least HOLD, but never lowers a BLOCK', () => {
    expect(score(outcomes(), { ...clean, validHttps: false }).verdict).toBe('HOLD');
    expect(score(outcomes({ clone: 'fail', price: 'fail' }), { ...clean, validHttps: false }).verdict).toBe('BLOCK');
  });

  it('unknown HTTPS (null) does not trigger the HTTPS rule', () => {
    expect(hardRules({ ...clean, validHttps: null })).toEqual([]);
  });

  it.each([
    [29, 40.1, true],
    [29, 40, false],
    [30, 41, false],
    [0, 99, true],
  ])('domain %i days + price %f%% below → young_domain_cheap_price: %s', (days, below, fires) => {
    const r = score(outcomes(), { ...clean, domainAgeDays: days, priceBelowPeersPct: below });
    expect(r.hardRulesTriggered.includes('young_domain_cheap_price')).toBe(fires);
    if (fires) expect(r.verdict).toBe('HOLD');
  });

  it('young-domain rule needs both facts known', () => {
    expect(hardRules({ ...clean, domainAgeDays: 3, priceBelowPeersPct: null })).toEqual([]);
    expect(hardRules({ ...clean, domainAgeDays: null, priceBelowPeersPct: 80 })).toEqual([]);
  });
});

describe("can't verify", () => {
  it('KERNEL failure → at least HOLD, never SAFE', () => {
    const r = score(outcomes({ ssl_redirects: 'unavailable', price: 'unavailable', clone: 'unavailable' }), { ...clean, kernelOk: false });
    expect(r.score).toBe(0);
    expect(r.verdict).toBe('HOLD');
    expect(r.hardRulesTriggered).toEqual(['cant_verify']);
  });

  it('an unavailable AI signal alone does not push a clean store to HOLD', () => {
    const r = score(outcomes({ ai_page: 'unavailable' }), clean);
    expect(r.verdict).toBe('SAFE');
    expect(r.hardRulesTriggered).toEqual([]);
  });

  it('a missing signal is reported as unavailable, not dropped', () => {
    const r = score(outcomes().filter((o) => o.id !== 'threat_list'), clean);
    expect(r.signals.map((s) => s.id)).toEqual([...SIGNAL_IDS]);
    expect(r.signals[4]).toMatchObject({ id: 'threat_list', status: 'unavailable', points: 0 });
  });
});
