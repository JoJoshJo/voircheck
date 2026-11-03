/**
 * History's "Stopped before paying" (Nov 3): (a) voided payments + (b) the price of BLOCK offers VoirCheck refused
 * before any order existed (the agent's create_order or Auto-pay, from audit_log). One offer = one store in one
 * conversation, counted once; an offer with a voided payment is already in (a), and one where money moved or is
 * still held wasn't stopped, so its refusals don't count.
 */
export interface StoppedPayment {
  sessionId: string;
  storeUrl: string;
  status: string;
  amount: string;
  currency: string;
}

export interface RefusedOffer {
  sessionId: string;
  storeUrl: string;
  price: string | null;
  currency: string;
}

/** Voided (counted in a), or money moved / held: a refusal for the same offer adds nothing. */
const NOT_STOPPED_BY_REFUSAL = new Set(['approved', 'authorized', 'capture_pending', 'captured', 'voided', 'refund_pending', 'refunded']);

const offerKey = (o: { sessionId: string; storeUrl: string }) => `${o.sessionId}\n${o.storeUrl}`;

export function stoppedBeforePaying(payments: readonly StoppedPayment[], refused: readonly RefusedOffer[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const add = (currency: string, amount: string) => (totals[currency] = Math.round(((totals[currency] ?? 0) + Number(amount)) * 100) / 100);
  for (const p of payments) if (p.status === 'voided') add(p.currency, p.amount);
  const counted = new Set(payments.filter((p) => NOT_STOPPED_BY_REFUSAL.has(p.status)).map(offerKey));
  for (const r of refused) {
    const key = offerKey(r);
    if (r.price === null || counted.has(key)) continue;
    counted.add(key);
    add(r.currency, r.price);
  }
  return totals;
}
