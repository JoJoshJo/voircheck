import type { SignalId, SignalStatus } from '../schema';

/** What a signal reports; points are added by scoring.ts from the weights table. */
export interface SignalOutcome {
  id: SignalId;
  status: SignalStatus;
  evidence: string[];
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
}

export type Fetch = typeof fetch;

export const unavailable = (id: SignalId, ...evidence: string[]): SignalOutcome => ({ id, status: 'unavailable', evidence });

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
