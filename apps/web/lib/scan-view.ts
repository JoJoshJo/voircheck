import type { HardRule, SignalResult, Verdict } from '@voircheck/scanner';

/** What the browser gets about a finished scan. Plain data; evidence is rendered as text, never HTML. */
export interface ScanView {
  id: string;
  url: string;
  domain: string;
  verdict: Verdict;
  score: number;
  signals: SignalResult[];
  hardRules: HardRule[];
  scannedAt: string;
}

export type ScanEvent =
  | { type: 'start'; url: string }
  | { type: 'browser'; liveViewUrl: string | null }
  | { type: 'signal'; id: SignalResult['id']; status: SignalResult['status']; points: number }
  | { type: 'done'; scan: ScanView }
  | { type: 'cached'; scan: ScanView }
  | { type: 'error'; code: 'auth' | 'rate' | 'url' | 'failed' };

export function toScanView(row: { id: string; url: string; storeDomain: string; verdict: Verdict; riskScore: number; signals: unknown; hardRulesTriggered: string[]; scannedAt: Date }): ScanView {
  return {
    id: row.id,
    url: row.url,
    domain: row.storeDomain,
    verdict: row.verdict,
    score: row.riskScore,
    signals: row.signals as SignalResult[],
    hardRules: row.hardRulesTriggered as HardRule[],
    scannedAt: row.scannedAt.toISOString(),
  };
}
