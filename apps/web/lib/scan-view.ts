import { cantVerifyOnly, type CantVerify, type HardRule, type SignalResult, type Verdict } from '@voircheck/scanner';

/** What the browser gets about a finished scan. Plain data; evidence is rendered as text, never HTML. */
export interface ScanView {
  id: string;
  url: string;
  domain: string;
  verdict: Verdict;
  score: number;
  signals: SignalResult[];
  hardRules: HardRule[];
  /** Set when the verdict is HOLD only because the store couldn't be verified (spec 5.18). */
  cantVerify: CantVerify | null;
  scannedAt: string;
}

/** The thing that could be bought from this result. Price comes from our own rows; null = nothing to pay. */
export interface CandidateView {
  id: string;
  storeName: string;
  productTitle: string;
  price: string | null;
  currency: string;
}

export type ScanEvent =
  | { type: 'start'; url: string }
  | { type: 'browser'; liveViewUrl: string | null }
  | { type: 'signal'; id: SignalResult['id']; status: SignalResult['status']; points: number }
  | { type: 'done'; scan: ScanView; candidate: CandidateView }
  | { type: 'cached'; scan: ScanView; candidate: CandidateView }
  | { type: 'error'; code: 'auth' | 'rate' | 'cap' | 'url' | 'failed' };

export function toScanView(row: { id: string; url: string; storeDomain: string; verdict: Verdict; riskScore: number; signals: unknown; hardRulesTriggered: string[]; scannedAt: Date }): ScanView {
  const signals = row.signals as SignalResult[];
  const hardRules = row.hardRulesTriggered as HardRule[];
  return {
    id: row.id,
    url: row.url,
    domain: row.storeDomain,
    verdict: row.verdict,
    score: row.riskScore,
    signals,
    hardRules,
    cantVerify: cantVerifyOnly({ verdict: row.verdict, score: row.riskScore, hardRules, signals }),
    scannedAt: row.scannedAt.toISOString(),
  };
}
