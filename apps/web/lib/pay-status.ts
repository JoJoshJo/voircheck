/**
 * Which title/body the pay page shows for a payment status. "awaiting" = the order exists but the person hasn't
 * approved it in PayPal yet (nothing charged); "pending" = approved, PayPal or VoirCheck still settling it.
 */
export const PAY_TITLE = {
  created: 'awaiting',
  approved: 'pending',
  capture_pending: 'pending',
  captured: 'captured',
  authorized: 'held',
  voided: 'voided',
  cancelled: 'cancelled',
  replaced: 'replaced',
  capture_denied: 'denied',
  failed: 'denied',
  refund_pending: 'refund_pending',
  refunded: 'refunded',
} as const;

export type PayTitleKey = (typeof PAY_TITLE)[keyof typeof PAY_TITLE] | 'expired';

export function payTitleKey(p: { status: keyof typeof PAY_TITLE; expired: boolean }): PayTitleKey {
  return p.expired ? 'expired' : PAY_TITLE[p.status];
}
