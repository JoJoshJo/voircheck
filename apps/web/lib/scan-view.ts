import { cantVerifyOnly, WebReputation, type CantVerify, type HardRule, type SignalResult, type Verdict } from '@voircheck/scanner';

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
  /** What the web says about the store (research step, no points); null on older scans or when it didn't run. */
  webReputation?: WebReputation | null;
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

export function toScanView(row: { id: string; url: string; storeDomain: string; verdict: Verdict; riskScore: number; signals: unknown; hardRulesTriggered: string[]; scannedAt: Date; explanation?: unknown }): ScanView {
  const web = WebReputation.safeParse((row.explanation as { webReputation?: unknown } | null | undefined)?.webReputation);
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
    webReputation: web.success ? web.data : null,
    scannedAt: row.scannedAt.toISOString(),
  };
}
