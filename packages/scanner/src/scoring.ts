import type { HardRule, SignalId, SignalResult, SignalStatus, Verdict } from './schema';
import { SIGNAL_IDS } from './schema';
import type { ScanFacts, SignalOutcome } from './signals/types';

/**
 * Points per signal and status (spec 5.6). Score = sum, capped at 100. Starting values, to be tuned on the
 * real-world test set (spec 5.5).
 *
 * Why these numbers:
 * - Every "warn" stays SAFE on its own (max 20); two warns can reach HOLD.
 * - Every "fail" except domain_age reaches HOLD on its own. No single check reaches BLOCK (65) alone: the
 *   biggest weight is 40, so findings have to add up (e.g. clone fail + fresh domain: 40 + 25, or AI fail +
 *   price fail: 35 + 30; warns count too). There is no "two signals" rule, only the sum and the hard rules.
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

export const HARD_RULE_LIMITS = { youngDomainDays: 30, cheapPricePct: 40, weakPageDomainDays: 180, weakPageAiRisk: 30 } as const;

/** Points of the web row (spec 5.6, Nov 8); a Tranco top-100k store gets HOLD-level points for an authority warning. */
export function webPoints(strength: ScanFacts['webStrength'], wellKnownRank: number | null | undefined): number {
  if (strength === 'authority') return wellKnownRank ? 30 : 65;
  return strength === 'reports' ? 30 : 0;
}

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
  // Spec 5.6 (Nov 1): a page that tries to instruct AI agents is never SAFE.
  if (facts.aiInjection) out.push({ rule: 'prompt_injection_attempt', floor: 'HOLD' });
  // Spec 5.6 (Nov 8): what the web says, strong evidence only. An authority's warning is someone else's confirmed
  // finding (like a threat list); for a well-known site it may be about a copy of it, so only HOLD there.
  if (facts.webStrength === 'authority') out.push({ rule: 'authority_warning', floor: facts.wellKnownRank ? 'HOLD' : 'BLOCK' });
  else if (facts.webStrength === 'reports') out.push({ rule: 'scam_reports', floor: 'HOLD' });
  // Spec 5.6 (Nov 8): a young domain whose page also looks weak. None of the 30 real shops of the Nov 8 eval matched
  // (none is under 180 days); 14 of the 54 online fake shops did.
  if (
    facts.domainAgeDays !== null &&
    facts.domainAgeDays < HARD_RULE_LIMITS.weakPageDomainDays &&
    ((facts.aiRisk ?? 0) >= HARD_RULE_LIMITS.weakPageAiRisk || facts.aiMissingIdentity)
  ) {
    out.push({ rule: 'young_domain_weak_page', floor: 'HOLD' });
  }
  return out;
}

/**
 * Spec 5.6 (Nov 7, narrowed the same day): the page itself couldn't be judged (page analysis didn't run on it), AND
 * price, copycat and what the web says (research step) all couldn't be checked, AND another check found something
 * worth a look → never SAFE ("We couldn't check everything. Be careful."). When page analysis did read the shop's real
 * page, a lone "worth a look" (a young domain, a redirect) stays SAFE: the 2026-11-08 eval held funstasy.at, a
 * certified shop, on that alone. When we were sent away or the page didn't load, cant_verify already holds the store
 * and says why, so this rule isn't added on top. `reputationChecked` false/absent = not checked.
 */
export function uncheckedCoreSignals(signals: ReadonlyArray<Pick<SignalResult, 'id' | 'status'>>, kernelOk: boolean, reputationChecked = false): boolean {
  if (!kernelOk || reputationChecked) return false;
  const st = (id: SignalId) => signals.find((s) => s.id === id)?.status ?? 'unavailable';
  if (st('ai_page') !== 'unavailable') return false; // the page was judged
  if (st('price') !== 'unavailable' || st('clone') !== 'unavailable') return false;
  return (['domain_age', 'ssl_redirects', 'threat_list'] as const).some((id) => st(id) === 'warn' || st(id) === 'fail');
}

export function score(outcomes: SignalOutcome[], facts: ScanFacts): { signals: SignalResult[]; score: number; verdict: Verdict; hardRulesTriggered: HardRule[] } {
  const signals = SIGNAL_IDS.map((id): SignalResult => {
    const o = outcomes.find((x) => x.id === id);
    if (!o) return { id, status: 'unavailable', points: 0, evidence: ['Signal did not run.'] };
    const base = { id, status: o.status, points: WEIGHTS[id][o.status], evidence: o.evidence.map((e) => e.slice(0, 500)).slice(0, 20) };
    return { ...base, ...(o.collected ? { collected: o.collected } : {}), ...(o.findings ? { findings: o.findings } : {}), ...(o.summary ? { summary: o.summary } : {}), ...(o.analyzedBy ? { analyzedBy: o.analyzedBy } : {}) };
  });
  const total = Math.min(100, signals.reduce((sum, s) => sum + s.points, 0) + webPoints(facts.webStrength, facts.wellKnownRank));
  const rules = hardRules(facts);
  if (uncheckedCoreSignals(signals, facts.kernelOk, facts.reputationChecked)) rules.push({ rule: 'unchecked_core_signals', floor: 'HOLD' });
  const verdict = rules.reduce((v, r) => atLeast(v, r.floor), verdictForScore(total));
  return { signals, score: total, verdict, hardRulesTriggered: rules.map((r) => r.rule) };
}
