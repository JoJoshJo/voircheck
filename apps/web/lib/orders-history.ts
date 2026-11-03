import { outcomeFor, type PaymentRecord } from './risk-log-map';

/**
 * History → Orders (Nov 3): one card per VC order with ONE status, whatever conversation or link check it came from.
 * Pure mapping from the payment rows the risk log already loads (owned through shopping_sessions).
 */
export type OrderStatus = 'paid' | 'refund_pending' | 'refunded' | 'waiting' | 'held' | 'expired' | 'replaced' | 'voided' | 'not_paid';

export interface OrderCard {
  paymentId: string;
  ref: string;
  store: string;
  item: string;
  amount: string;
  currency: string;
  at: string;
  status: OrderStatus;
  /** Public Trust Receipt, once the order was settled. */
  receiptSlug: string | null;
  /** The scan the order was decided on (payments.scan_id): chat and link orders alike. */
  scanId: string | null;
  /** Only a paid order offers "Request refund" (MoneyGate re-checks ownership, status and PayPal's window). */
  refundable: boolean;
  /** Waiting for the person in PayPal (or on hold for their decision): link to the signed-in pay page. */
  needsYou: boolean;
}

export function orderStatus(p: Pick<PaymentRecord, 'status' | 'overrideUsed' | 'createdAt'>, now: number = Date.now()): OrderStatus {
  const o = outcomeFor(p, now);
  if (o === 'paid' || o === 'paid_override') return 'paid';
  if (o === 'checked') return 'not_paid';
  return o;
}

export function toOrderCards(records: readonly PaymentRecord[], now: number = Date.now()): OrderCard[] {
  const seen = new Set<string>();
  const cards: OrderCard[] = [];
  for (const r of records) {
    if (seen.has(r.paymentId)) continue; // one card per order, even if a join repeated the row
    seen.add(r.paymentId);
    const status = orderStatus(r, now);
    cards.push({
      paymentId: r.paymentId,
      ref: r.ref,
      store: r.storeName,
      item: r.productTitle,
      amount: r.amount,
      currency: r.currency,
      at: r.createdAt.toISOString(),
      status,
      receiptSlug: r.receiptSlug,
      scanId: r.scanId,
      refundable: status === 'paid',
      needsYou: status === 'waiting' || status === 'held',
    });
  }
  return cards.sort((a, b) => b.at.localeCompare(a.at));
}

export interface OrderTotals {
  paidByCurrency: Record<string, number>;
  refundedByCurrency: Record<string, number>;
  waiting: number;
}

export function orderTotals(cards: readonly OrderCard[]): OrderTotals {
  const t: OrderTotals = { paidByCurrency: {}, refundedByCurrency: {}, waiting: 0 };
  const add = (m: Record<string, number>, c: OrderCard) => (m[c.currency] = Math.round(((m[c.currency] ?? 0) + Number(c.amount)) * 100) / 100);
  for (const c of cards) {
    if (c.status === 'paid') add(t.paidByCurrency, c);
    if (c.status === 'refunded') add(t.refundedByCurrency, c);
    if (c.needsYou) t.waiting += 1;
  }
  return t;
}
