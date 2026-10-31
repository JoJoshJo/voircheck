/**
 * Real-world eval (spec 5.5 "Eval method"): pure metric math over scan rows, so it can be unit tested.
 * Scam caught = HOLD or BLOCK. Legit HOLD = soft false alarm, legit BLOCK = hard false alarm.
 * Dead sites (unreachable / parked / redirect to an unrelated domain) and runner errors are excluded from accuracy.
 */
import type { CollectedEvidence, HardRule, SignalId, SignalStatus, Verdict } from '@voircheck/scanner';

export type Label = 'scam' | 'legit';
/**
 * tune: may inform rules. seen-2026-10-31: the original test split, run once as the before-AI baseline; seen, so never
 * a final number. holdout: final reported numbers; scams first reported after HOLDOUT_AFTER + fresh legit shops.
 */
export const SPLITS = ['tune', 'seen-2026-10-31', 'holdout'] as const;
export type Split = (typeof SPLITS)[number];
export const HOLDOUT_AFTER = '2026-10-31';

export interface EvalStore {
  url: string;
  label: Label;
  split: Split;
  source: string;
  sourceUrl: string;
  addedOn: string;
  /** Scams: the day the source first reported the shop (holdout scams must be after HOLDOUT_AFTER). */
  reportedOn?: string;
  notes: string;
}

export interface EvalSignal {
  id: SignalId;
  status: SignalStatus;
  points: number;
  evidence: string[];
}

export type EvalRow =
  | { url: string; label: Label; split: Split; outcome: 'dead'; deadReason: string }
  | { url: string; label: Label; split: Split; outcome: 'error'; error: string }
  | {
      url: string;
      label: Label;
      split: Split;
      outcome: 'scanned';
      verdict: Verdict;
      score: number;
      hardRules: HardRule[];
      signals: EvalSignal[];
      scanMs: number;
      kernelError: string | null;
      /** Pages + facts collected for page analysis (evidence only, not scored). */
      collected?: CollectedEvidence;
    };
export type ScannedRow = Extract<EvalRow, { outcome: 'scanned' }>;

export function loadStores(raw: unknown): EvalStore[] {
  const stores = (raw as { stores?: unknown })?.stores;
  if (!Array.isArray(stores)) throw new Error('eval/stores.json: missing "stores" array');
  const seen = new Set<string>();
  return stores.map((s, i) => {
    const e = s as Partial<EvalStore>;
    const where = `eval/stores.json entry ${i}`;
    if (typeof e.url !== 'string' || !/^https?:\/\//.test(e.url)) throw new Error(`${where}: bad url`);
    if (e.label !== 'scam' && e.label !== 'legit') throw new Error(`${where}: label must be scam|legit`);
    if (!(SPLITS as readonly string[]).includes(e.split as string)) throw new Error(`${where}: split must be ${SPLITS.join('|')}`);
    if (e.split === 'holdout' && e.label === 'scam' && !(typeof e.reportedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.reportedOn) && e.reportedOn > HOLDOUT_AFTER)) {
      throw new Error(`${where}: holdout scams must have reportedOn after ${HOLDOUT_AFTER}`);
    }
    if (!e.source || !e.sourceUrl) throw new Error(`${where}: ground truth needs a named source and sourceUrl`);
    if (seen.has(e.url)) throw new Error(`${where}: duplicate url ${e.url}`);
    seen.add(e.url);
    return { url: e.url, label: e.label, split: e.split as Split, source: e.source, sourceUrl: e.sourceUrl, addedOn: e.addedOn ?? '', ...(e.reportedOn ? { reportedOn: e.reportedOn } : {}), notes: e.notes ?? '' };
  });
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const rate = (n: number, d: number) => (d === 0 ? null : n / d);
const zero = (): Record<Verdict, number> => ({ SAFE: 0, HOLD: 0, BLOCK: 0 });
const STATUSES: SignalStatus[] = ['fail', 'warn', 'pass', 'unavailable'];

export interface SignalStats {
  counts: Record<SignalStatus, number>;
  /** fail or warn, out of the rows where the signal was available (null if never available). */
  hitRate: number | null;
  /** Share of rows where the signal produced a result at all. */
  coverage: number | null;
}

export interface EvalMetrics {
  total: number;
  dead: number;
  deadByLabel: Record<Label, number>;
  errors: number;
  scored: Record<Label, number>;
  scam: Record<Verdict, number>;
  legit: Record<Verdict, number>;
  catchRate: number | null;
  /** Scams caught only because the scan couldn't verify the store (cant_verify), not by a red flag. */
  scamCaughtByCantVerifyOnly: number;
  softFalseAlarmRate: number | null;
  hardFalseAlarmRate: number | null;
  perSignal: Record<Label, Partial<Record<SignalId, SignalStats>>>;
  medianScanMs: number | null;
  misses: ScannedRow[];
  falseAlarms: ScannedRow[];
  /** How often each collected fact was found, per label, out of the scored rows. */
  facts: Array<{ fact: string; scam: number; legit: number }>;
}

/** Facts reported per label (Task: "free-mail contact email: scam X/8, legit Y/9"). */
export const FACT_CHECKS: Array<[string, (c: CollectedEvidence) => boolean]> = [
  ['extra pages read (any)', (c) => c.pages.length > 1],
  ['legal notice / Impressum page', (c) => c.pages.some((p) => p.kind === 'legal')],
  ['contact / about page', (c) => c.pages.some((p) => p.kind === 'contact')],
  ['returns / shipping / terms page', (c) => c.pages.some((p) => p.kind === 'terms')],
  ['product page', (c) => c.pages.some((p) => p.kind === 'product')],
  ['company name with legal form', (c) => c.facts.companyNames.length > 0],
  ['postal address', (c) => c.facts.addresses.length > 0],
  ['phone number', (c) => c.facts.phones.length > 0],
  ['any contact email', (c) => c.facts.emails.length > 0],
  ['free-mail contact email', (c) => c.facts.freeMailContact],
  ['email on the store\'s own domain', (c) => c.facts.emails.some((e) => e.matchesStoreDomain)],
  ['VAT / company registration number', (c) => c.facts.registrationIds.length > 0],
  ['PayPal mentioned', (c) => c.facts.paymentMethods.includes('PayPal')],
  ['bank transfer / prepayment mentioned', (c) => c.facts.paymentMethods.includes('Bank transfer / prepayment')],
  ['return policy mentioned', (c) => c.facts.returnPolicy],
  ['discount of 50% or more seen', (c) => c.facts.discountsPct.some((d) => d >= 50)],
];

function signalStats(rows: ScannedRow[]): Partial<Record<SignalId, SignalStats>> {
  const out: Partial<Record<SignalId, SignalStats>> = {};
  for (const r of rows) {
    for (const s of r.signals) {
      const st = (out[s.id] ??= { counts: { fail: 0, warn: 0, pass: 0, unavailable: 0 }, hitRate: null, coverage: null });
      st.counts[s.status]++;
    }
  }
  for (const st of Object.values(out)) {
    const total = STATUSES.reduce((a, k) => a + st.counts[k], 0);
    const available = total - st.counts.unavailable;
    st.hitRate = rate(st.counts.fail + st.counts.warn, available);
    st.coverage = rate(available, total);
  }
  return out;
}

const caught = (v: Verdict) => v === 'HOLD' || v === 'BLOCK';

export function computeMetrics(rows: EvalRow[]): EvalMetrics {
  const scanned = rows.filter((r): r is ScannedRow => r.outcome === 'scanned');
  const scams = scanned.filter((r) => r.label === 'scam');
  const legits = scanned.filter((r) => r.label === 'legit');
  const scam = zero();
  const legit = zero();
  for (const r of scams) scam[r.verdict]++;
  for (const r of legits) legit[r.verdict]++;
  const dead = rows.filter((r) => r.outcome === 'dead');
  return {
    total: rows.length,
    dead: dead.length,
    deadByLabel: { scam: dead.filter((r) => r.label === 'scam').length, legit: dead.filter((r) => r.label === 'legit').length },
    errors: rows.filter((r) => r.outcome === 'error').length,
    scored: { scam: scams.length, legit: legits.length },
    scam,
    legit,
    catchRate: rate(scam.HOLD + scam.BLOCK, scams.length),
    scamCaughtByCantVerifyOnly: scams.filter((r) => caught(r.verdict) && r.hardRules.includes('cant_verify') && !r.signals.some((s) => s.status === 'fail' || s.status === 'warn')).length,
    softFalseAlarmRate: rate(legit.HOLD, legits.length),
    hardFalseAlarmRate: rate(legit.BLOCK, legits.length),
    perSignal: { scam: signalStats(scams), legit: signalStats(legits) },
    medianScanMs: median(scanned.map((r) => r.scanMs)),
    misses: scams.filter((r) => r.verdict === 'SAFE'),
    falseAlarms: legits.filter((r) => caught(r.verdict)),
    facts: FACT_CHECKS.map(([fact, has]) => ({
      fact,
      scam: scams.filter((r) => r.collected && has(r.collected)).length,
      legit: legits.filter((r) => r.collected && has(r.collected)).length,
    })),
  };
}
