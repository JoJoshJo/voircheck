import type { ScanReport } from '@voircheck/scanner';
import type { EvalRow, EvalStore } from './metrics';

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
  };
}

export function selectStores(stores: EvalStore[], split: 'tune' | 'test' | 'all', limit?: number): EvalStore[] {
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
