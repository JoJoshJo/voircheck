import { cantVerifyOnly, type HardRule, type SignalResult, type Verdict } from '@voircheck/scanner';
import { z } from 'zod';

/**
 * Trust Receipts (spec 5.9): public via an unguessable link; store, evidence, verdict and the PayPal action taken.
 * The snapshot never contains personal info: no name, email, user id or PayPal IDs (order/authorization/capture).
 */
export type ReceiptAction = 'captured' | 'held' | 'voided' | 'override' | 'cancelled' | 'declined' | 'pending' | 'refund_pending' | 'refunded';

export const ReceiptSnapshot = z.object({
  v: z.literal(1),
  /** VoirCheck's own order reference (VC-7K2F; not a PayPal ID). Optional: receipts made before Nov 2 don't have it. */
  ref: z.string().optional(),
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
  /** HOLD only because the store couldn't be verified: why (optional; older receipts don't have it). */
  cantVerify: z.object({ reason: z.enum(['bot_check', 'error_page', 'empty_page', 'visit_failed']), httpStatus: z.number().optional() }).nullable().optional(),
  signals: z.array(z.object({ id: z.string(), status: z.string(), points: z.number(), summary: z.string() })),
  action: z.enum(['captured', 'held', 'voided', 'override', 'cancelled', 'declined', 'pending', 'refund_pending', 'refunded']),
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
  if (status === 'refund_pending') return 'refund_pending';
  if (status === 'refunded') return 'refunded';
  return null; // created / approved: nothing decided yet
}

/** Pure: builds the public snapshot from rows we already trust. Only whitelisted fields are copied. */
export function buildSnapshot(input: {
  payment: { status: string; overrideUsed: boolean; amount: string | null; currency: string; ref?: string };
  candidate: { storeName: string; storeUrl: string; productTitle: string };
  scan: { verdict: Verdict; riskScore: number; hardRulesTriggered: string[]; signals: unknown; scannedAt: Date };
  now: Date;
}): ReceiptSnapshot | null {
  const action = actionFor(input.payment.status, input.payment.overrideUsed);
  if (!action) return null;
  const cantVerify = cantVerifyOnly({ verdict: input.scan.verdict, score: input.scan.riskScore, hardRules: input.scan.hardRulesTriggered, signals: input.scan.signals as SignalResult[] });
  const signals = (input.scan.signals as SignalResult[]).map((s) => ({ id: s.id, status: s.status, points: s.points, summary: (s.evidence.find((e) => !e.startsWith('This store shares')) ?? s.evidence[0] ?? '').slice(0, 300) }));
  return ReceiptSnapshot.parse({
    v: 1,
    ...(input.payment.ref ? { ref: input.payment.ref } : {}),
    storeName: input.candidate.storeName,
    storeHost: new URL(input.candidate.storeUrl).host,
    storeUrl: input.candidate.storeUrl,
    productTitle: input.candidate.productTitle,
    amount: input.payment.amount,
    currency: input.payment.currency,
    verdict: input.scan.verdict,
    score: input.scan.riskScore,
    hardRules: input.scan.hardRulesTriggered as HardRule[],
    cantVerify,
    signals,
    action,
    actionAt: input.now.toISOString(),
    scannedAt: input.scan.scannedAt.toISOString(),
  });
}

