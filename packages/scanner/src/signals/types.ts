import type { CollectedEvidence } from '../evidence-pages';
import type { AiFinding, AiSummary, SignalId, SignalStatus } from '../schema';

/** What a signal reports; points are added by scoring.ts from the weights table. */
export interface SignalOutcome {
  id: SignalId;
  status: SignalStatus;
  evidence: string[];
  collected?: CollectedEvidence;
  /** ai_page only. */
  findings?: AiFinding[];
  /** ai_page only: plain-language summary (EN + FR). */
  summary?: AiSummary;
  /** ai_page only: tokens and cost of the model call (operational; never part of the result). */
  usage?: AiUsage;
}

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** true when the result came from the 24h per-URL cache (no model call, cost 0). */
  cached: boolean;
}

/** Raw facts the hard rules need (spec 5.6); never shown to the user directly. */
export interface ScanFacts {
  domainAgeDays: number | null;
  validHttps: boolean | null;
  /** Percent below the peer median (negative = above). */
  priceBelowPeersPct: number | null;
  threatHit: boolean;
  /** False when the KERNEL page visit failed or timed out ("can't verify"). */
  kernelOk: boolean;
  /** Tranco rank of the store's own registrable domain (top 100k), else null. Recorded only; no rule uses it yet. */
  wellKnownRank?: number | null;
  /** The AI page analysis reported a prompt-injection attempt (hard rule: at least HOLD). */
  aiInjection?: boolean;
}

export type Fetch = typeof fetch;

export const unavailable = (id: SignalId, ...evidence: string[]): SignalOutcome => ({ id, status: 'unavailable', evidence });

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
