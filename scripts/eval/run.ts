import { THRESHOLDS, type HardRule, type ScanReport, type SignalResult, type Verdict } from '@voircheck/scanner';
import type { EvalRow, EvalStore, Split } from './metrics';

const ORDER: Verdict[] = ['SAFE', 'HOLD', 'BLOCK'];
const FLOOR: Record<HardRule, Verdict> = { threat_list_hit: 'BLOCK', no_valid_https: 'HOLD', young_domain_cheap_price: 'HOLD', cant_verify: 'HOLD', prompt_injection_attempt: 'HOLD', unchecked_core_signals: 'HOLD', authority_warning: 'BLOCK', scam_reports: 'HOLD', young_domain_weak_page: 'HOLD' };
/** Rules that need the AI's reading of the page, so they don't apply "without AI". */
const AI_RULES = new Set<HardRule>(['prompt_injection_attempt', 'young_domain_weak_page']);

/** The verdict this scan would have had without the AI signal: its points and its hard rule removed. */
export function scoreWithoutAi(signals: Pick<SignalResult, 'id' | 'points'>[], hardRules: HardRule[]): { verdict: Verdict; score: number } {
  const score = Math.min(100, signals.filter((s) => s.id !== 'ai_page').reduce((n, s) => n + s.points, 0));
  let verdict: Verdict = score >= THRESHOLDS.block ? 'BLOCK' : score >= THRESHOLDS.hold ? 'HOLD' : 'SAFE';
  for (const r of hardRules) if (!AI_RULES.has(r) && ORDER.indexOf(FLOOR[r]) > ORDER.indexOf(verdict)) verdict = FLOOR[r];
  return { verdict, score };
}

/** Rules that come from the web row (research step). */
const WEB_RULES = new Set<HardRule>(['authority_warning', 'scam_reports']);

/** The verdict without the web row: its points and its two rules removed (everything else as scored). */
export function scoreWithoutWeb(score: number, webPoints: number, hardRules: HardRule[]): { verdict: Verdict; score: number } {
  const s = Math.max(0, score - webPoints);
  let verdict: Verdict = s >= THRESHOLDS.block ? 'BLOCK' : s >= THRESHOLDS.hold ? 'HOLD' : 'SAFE';
  for (const r of hardRules) if (!WEB_RULES.has(r) && ORDER.indexOf(FLOOR[r]) > ORDER.indexOf(verdict)) verdict = FLOOR[r];
  return { verdict, score: s };
}

/** One scan → one result row. Drops the KERNEL object (session id, live-view and replay links carry tokens). */
export function toRow(store: EvalStore, report: ScanReport, scanMs: number, reach: { sentElsewhere?: string; gone?: number } = {}): EvalRow {
  const { result, meta } = report;
  const collected = result.signals.find((s) => s.id === 'ai_page')?.collected;
  return {
    url: store.url,
    label: store.label,
    split: store.split,
    outcome: 'scanned',
    verdict: result.verdict,
    score: result.score,
    hardRules: result.hardRulesTriggered,
    signals: result.signals.map((s) => ({ id: s.id, status: s.status, points: s.points, evidence: s.evidence })),
    scanMs: Math.round(scanMs),
    kernelError: meta.kernelError,
    ...(collected ? { collected } : {}),
    ai: meta.ai ? { inputTokens: meta.ai.inputTokens, outputTokens: meta.ai.outputTokens, cacheReadTokens: meta.ai.cacheReadTokens, cacheWriteTokens: meta.ai.cacheWriteTokens, costUsd: meta.ai.costUsd, cached: meta.ai.cached } : null,
    withoutAi: scoreWithoutAi(result.signals, result.hardRulesTriggered),
    withoutWeb: scoreWithoutWeb(result.score, result.webReputation?.points ?? 0, result.hardRulesTriggered),
    ...(reach.sentElsewhere
      ? { sentElsewhere: { via: 'http' as const, to: reach.sentElsewhere } }
      : /^it sent our check to /.test(meta.kernelError ?? '')
        ? { sentElsewhere: { via: 'browser' as const, to: meta.kernelError!.replace(/^it sent our check to (\S+).*$/, '$1') } }
        : {}),
    ...(reach.gone ? { gone: reach.gone } : {}),
    ...(result.webReputation ? { web: { status: result.webReputation.status, findings: result.webReputation.findings.length, kinds: result.webReputation.findings.map((f) => f.kind), details: result.webReputation.findings.map((f) => ({ kind: f.kind, sourceUrl: f.sourceUrl, note: f.note.en })) } } : {}),
    ...(meta.research?.length || (meta.researchMs ?? null) !== null
      ? { research: { costUsd: Math.round((meta.research ?? []).reduce((n, u) => n + u.costUsd, 0) * 1e6) / 1e6, searches: (meta.research ?? []).reduce((n, u) => n + u.searches, 0), ms: meta.researchMs ?? null } }
      : {}),
  };
}

export function selectStores(stores: EvalStore[], split: Split | 'all', limit?: number): EvalStore[] {
  const picked = split === 'all' ? stores : stores.filter((s) => s.split === split);
  return limit ? picked.slice(0, limit) : picked;
}

/** Run `fn` over items with at most `concurrency` in flight, waiting `delayMs` before each new start in a lane. */
export async function mapPool<T, R>(items: T[], concurrency: number, delayMs: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async (laneNo: number) => {
    let first = true;
    while (next < items.length) {
      const i = next++;
      if (!first || laneNo > 0) await new Promise((r) => setTimeout(r, first ? delayMs / 2 : delayMs));
      first = false;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, (_, k) => lane(k)));
  return out;
}
