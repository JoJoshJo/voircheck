import type { PaymentStatus } from './store';

/**
 * How long PayPal keeps an unapproved order (status CREATED): 6 hours by default per the Orders v2 reference ("6 hours
 * from the time the order is created, to redirect your payer"; an account manager can raise it to 24/48/72 h). One
 * PayPal guide says 3 hours; we use 6 so we never call an order expired while PayPal still accepts it.
 * Display only: an expired order never charged or held anything, and MoneyGate's checks are unchanged.
 */
export const ORDER_APPROVAL_WINDOW_MS = 6 * 3_600_000;

export type ShownPaymentStatus = PaymentStatus | 'expired';

/** Our row's status as the person should see it: an order still waiting for approval past PayPal's window is "expired". */
export function shownPaymentStatus(p: { status: PaymentStatus | string; createdAt: Date | string }, now: number = Date.now()): ShownPaymentStatus {
  const created = typeof p.createdAt === 'string' ? Date.parse(p.createdAt) : p.createdAt.getTime();
  if (p.status === 'created' && now - created > ORDER_APPROVAL_WINDOW_MS) return 'expired';
  return p.status as PaymentStatus;
}
