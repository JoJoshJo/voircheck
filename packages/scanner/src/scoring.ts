import type { HardRule, SignalId, SignalResult, SignalStatus, Verdict } from './schema';
import { SIGNAL_IDS } from './schema';
import type { ScanFacts, SignalOutcome } from './signals/types';

/**
 * Points per signal and status (spec 5.6). Score = sum, capped at 100. Starting values, to be tuned on the
 * real-world test set (spec 5.5).
 *
 * Why these numbers:
 * - Every "warn" stays SAFE on its own (max 20); two warns can reach HOLD.
 * - Every "fail" except domain_age reaches HOLD on its own. BLOCK (65) needs two independent strong
 *   signals: clone fail + any other fail (e.g. a fresh domain: 40 + 25), or AI fail + price fail (35 + 30).
 * - clone fail (40): a store that both borrows another store's name/domain AND copies its page is the
 *   textbook fake shop; it is the strongest non-list evidence we have.
 * - ai_page fail (35): many tells at once (no contact, fake reviews, off-platform payment). Strong, but
 *   it's a model's judgment, so a bit below clone. "unavailable" = 0 so a missing AI key never causes HOLD.
 * - price fail (30): >40% below peers is a classic lure, but real sales exist, so it only reaches HOLD alone.
 * - domain_age fail (25): fresh domains are common for scams but also for new honest shops; alone it stays
 *   SAFE, combined with a cheap price the hard rule lifts it to HOLD.
 * - ssl_redirects: fail 30 (no valid HTTPS is also a hard rule); warn 15 for cross-domain redirects.
 * - threat_list fail (100): a Google Safe Browsing hit is someone else's confirmed finding; BLOCK by hard rule too.
 * - "unavailable" is 0 everywhere; the can't-verify hard rule handles a failed KERNEL visit instead.
 */
export const WEIGHTS: Record<SignalId, Record<SignalStatus, number>> = {
  domain_age: { pass: 0, warn: 10, fail: 25, unavailable: 0 },
  ssl_redirects: { pass: 0, warn: 15, fail: 30, unavailable: 0 },
  price: { pass: 0, warn: 12, fail: 30, unavailable: 0 },
  ai_page: { pass: 0, warn: 15, fail: 35, unavailable: 0 },
  threat_list: { pass: 0, warn: 0, fail: 100, unavailable: 0 },
  clone: { pass: 0, warn: 20, fail: 40, unavailable: 0 },
};

/** 0–29 SAFE, 30–64 HOLD, 65–100 BLOCK. */
export const THRESHOLDS = { hold: 30, block: 65 } as const;

export const HARD_RULE_LIMITS = { youngDomainDays: 30, cheapPricePct: 40 } as const;

const ORDER: Verdict[] = ['SAFE', 'HOLD', 'BLOCK'];
const atLeast = (v: Verdict, floor: Verdict): Verdict => (ORDER.indexOf(v) >= ORDER.indexOf(floor) ? v : floor);

export function verdictForScore(score: number): Verdict {
  return score >= THRESHOLDS.block ? 'BLOCK' : score >= THRESHOLDS.hold ? 'HOLD' : 'SAFE';
}

export function hardRules(facts: ScanFacts): Array<{ rule: HardRule; floor: Verdict }> {
  const out: Array<{ rule: HardRule; floor: Verdict }> = [];
  if (facts.threatHit) out.push({ rule: 'threat_list_hit', floor: 'BLOCK' });
  if (facts.validHttps === false) out.push({ rule: 'no_valid_https', floor: 'HOLD' });
  if (
    facts.domainAgeDays !== null &&
    facts.domainAgeDays < HARD_RULE_LIMITS.youngDomainDays &&
    facts.priceBelowPeersPct !== null &&
    facts.priceBelowPeersPct > HARD_RULE_LIMITS.cheapPricePct
  ) {
    out.push({ rule: 'young_domain_cheap_price', floor: 'HOLD' });
  }
  // Spec 5.18: if VoirCheck can't verify a store, it is never SAFE.
  if (!facts.kernelOk) out.push({ rule: 'cant_verify', floor: 'HOLD' });
  return out;
}

export function score(outcomes: SignalOutcome[], facts: ScanFacts): { signals: SignalResult[]; score: number; verdict: Verdict; hardRulesTriggered: HardRule[] } {
  const signals = SIGNAL_IDS.map((id): SignalResult => {
    const o = outcomes.find((x) => x.id === id);
    if (!o) return { id, status: 'unavailable', points: 0, evidence: ['Signal did not run.'] };
    return { id, status: o.status, points: WEIGHTS[id][o.status], evidence: o.evidence.map((e) => e.slice(0, 500)).slice(0, 20) };
  });
  const total = Math.min(100, signals.reduce((sum, s) => sum + s.points, 0));
  const rules = hardRules(facts);
  const verdict = rules.reduce((v, r) => atLeast(v, r.floor), verdictForScore(total));
  return { signals, score: total, verdict, hardRulesTriggered: rules.map((r) => r.rule) };
}
