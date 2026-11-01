import { THRESHOLDS, type HardRule, type ScanReport, type SignalResult, type Verdict } from '@voircheck/scanner';
import type { EvalRow, EvalStore, Split } from './metrics';

const ORDER: Verdict[] = ['SAFE', 'HOLD', 'BLOCK'];
const FLOOR: Record<HardRule, Verdict> = { threat_list_hit: 'BLOCK', no_valid_https: 'HOLD', young_domain_cheap_price: 'HOLD', cant_verify: 'HOLD', prompt_injection_attempt: 'HOLD' };

/** The verdict this scan would have had without the AI signal: its points and its hard rule removed. */
export function scoreWithoutAi(signals: Pick<SignalResult, 'id' | 'points'>[], hardRules: HardRule[]): { verdict: Verdict; score: number } {
  const score = Math.min(100, signals.filter((s) => s.id !== 'ai_page').reduce((n, s) => n + s.points, 0));
  let verdict: Verdict = score >= THRESHOLDS.block ? 'BLOCK' : score >= THRESHOLDS.hold ? 'HOLD' : 'SAFE';
  for (const r of hardRules) if (r !== 'prompt_injection_attempt' && ORDER.indexOf(FLOOR[r]) > ORDER.indexOf(verdict)) verdict = FLOOR[r];
  return { verdict, score };
}

/** One scan → one result row. Drops the KERNEL object (session id, live-view and replay links carry tokens). */
export function toRow(store: EvalStore, report: ScanReport, scanMs: number): EvalRow {
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
