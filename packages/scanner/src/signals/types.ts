import type { CollectedEvidence } from '../evidence-pages';
import type { AnalyzedBy } from '../llm';
import type { AiFinding, AiSummary, SignalId, SignalStatus } from '../schema';

/** What a signal reports; points are added by scoring.ts from the weights table. */
export interface SignalOutcome {
  id: SignalId;
  status: SignalStatus;
  evidence: string[];
  collected?: CollectedEvidence;
  /** ai_page only. */
  findings?: AiFinding[];
  /** ai_page only: the model's overall risk 0–100 (feeds the young-domain rule; the status already reflects it). */
  risk?: number;
  /** ai_page only: plain-language summary (EN + FR). */
  summary?: AiSummary;
  /** ai_page only: which AI provider answered. */
  analyzedBy?: AnalyzedBy;
  /** ai_page only: tokens and cost of the model call (operational; never part of the result). */
  usage?: AiUsage;
  /** ai_page only: the page's main product as the model read it (feeds the price check; never part of the result). */
  product?: { name: string; price: number; currency: string | null };
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
  /** The research step found what other sites say about the store (sourced findings). Unchecked → see unchecked_core_signals. */
  reputationChecked?: boolean;
  /** Strong evidence from the research step (spec 5.6, Nov 8): an authority warning or scam reports from 2+ sites. */
  webStrength?: 'authority' | 'reports' | null;
  /** AI page analysis risk 0–100, when it ran on the shop's page. */
  aiRisk?: number | null;
  /** The AI reported missing legal info (who runs the shop) at high severity. */
  aiMissingIdentity?: boolean;
  /** A fake VoirCheck / PayPal trust badge on the shop's own page (quote), found by code, not AI. */
  fakeTrustBadge?: string | null;
}

export type Fetch = typeof fetch;

export const unavailable = (id: SignalId, ...evidence: string[]): SignalOutcome => ({ id, status: 'unavailable', evidence });

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
