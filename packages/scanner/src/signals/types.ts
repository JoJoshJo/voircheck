import type { CollectedEvidence } from '../evidence-pages';
import type { SignalId, SignalStatus } from '../schema';

/** What a signal reports; points are added by scoring.ts from the weights table. */
export interface SignalOutcome {
  id: SignalId;
  status: SignalStatus;
  evidence: string[];
  collected?: CollectedEvidence;
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
}

export type Fetch = typeof fetch;

export const unavailable = (id: SignalId, ...evidence: string[]): SignalOutcome => ({ id, status: 'unavailable', evidence });

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
