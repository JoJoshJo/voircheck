import type { HardRule, SignalResult, Verdict } from '@voircheck/scanner';
import { z } from 'zod';

/**
 * Trust Receipts (spec 5.9): public via an unguessable link; store, evidence, verdict and the PayPal action taken.
 * The snapshot never contains personal info: no name, email, user id or PayPal IDs (order/authorization/capture).
 */
export type ReceiptAction = 'captured' | 'held' | 'voided' | 'override' | 'cancelled' | 'declined' | 'pending';

export const ReceiptSnapshot = z.object({
  v: z.literal(1),
  storeName: z.string(),
  storeHost: z.string(),
  /** The store's own page (e.g. …/s/velbrook-supply). Optional: receipts made before Oct 29 only have the host. */
  storeUrl: z.string().optional(),
  productTitle: z.string(),
  amount: z.string().nullable(),
  currency: z.string(),
  verdict: z.enum(['SAFE', 'HOLD', 'BLOCK']),
  score: z.number(),
  hardRules: z.array(z.string()),
  signals: z.array(z.object({ id: z.string(), status: z.string(), points: z.number(), summary: z.string() })),
  action: z.enum(['captured', 'held', 'voided', 'override', 'cancelled', 'declined', 'pending']),
  actionAt: z.string(),
  scannedAt: z.string(),
});
export type ReceiptSnapshot = z.infer<typeof ReceiptSnapshot>;

export function actionFor(status: string, overrideUsed: boolean): ReceiptAction | null {
  if (status === 'captured') return overrideUsed ? 'override' : 'captured';
  if (status === 'authorized') return 'held';
  if (status === 'voided') return 'voided';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'capture_denied') return 'declined';
  if (status === 'capture_pending') return 'pending';
  return null; // created / approved: nothing decided yet
}

/** Pure: builds the public snapshot from rows we already trust. Only whitelisted fields are copied. */
export function buildSnapshot(input: {
  payment: { status: string; overrideUsed: boolean; amount: string | null; currency: string };
  candidate: { storeName: string; storeUrl: string; productTitle: string };
  scan: { verdict: Verdict; riskScore: number; hardRulesTriggered: string[]; signals: unknown; scannedAt: Date };
  now: Date;
}): ReceiptSnapshot | null {
  const action = actionFor(input.payment.status, input.payment.overrideUsed);
  if (!action) return null;
  const signals = (input.scan.signals as SignalResult[]).map((s) => ({ id: s.id, status: s.status, points: s.points, summary: (s.evidence.find((e) => !e.startsWith('This store shares')) ?? s.evidence[0] ?? '').slice(0, 300) }));
  return ReceiptSnapshot.parse({
    v: 1,
    storeName: input.candidate.storeName,
    storeHost: new URL(input.candidate.storeUrl).host,
    storeUrl: input.candidate.storeUrl,
    productTitle: input.candidate.productTitle,
    amount: input.payment.amount,
    currency: input.payment.currency,
    verdict: input.scan.verdict,
    score: input.scan.riskScore,
    hardRules: input.scan.hardRulesTriggered as HardRule[],
    signals,
    action,
    actionAt: input.now.toISOString(),
    scannedAt: input.scan.scannedAt.toISOString(),
  });
}

