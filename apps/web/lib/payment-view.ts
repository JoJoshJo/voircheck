import 'server-only';
import { scans } from '@voircheck/db/schema';
import type { PaymentStatus, Verdict } from '@voircheck/paypal';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { getPayPal } from './paypal';
import { receiptSlugForPayment } from './receipts';

const DAY = 86_400_000;

/** What the browser may know about a payment. No PayPal order/authorization/capture IDs. */
export interface PaymentView {
  id: string;
  status: PaymentStatus;
  mode: 'approve' | 'auto';
  overrideUsed: boolean;
  amount: string;
  currency: string;
  storeName: string;
  productTitle: string;
  verdict: Verdict | null;
  scanId: string | null;
  candidateId: string;
  receiptSlug: string | null;
  /** HOLD timing from PayPal's authorization (only while held). */
  hold: { honorEndsAt: string; expiresAt: string; canReauthorize: boolean } | null;
}

export async function getPaymentView(paymentId: string, userId: string): Promise<PaymentView | null> {
  const { store, paypal } = getPayPal();
  const payment = await store.getPaymentForUser(paymentId, userId);
  if (!payment) return null;
  const candidate = await store.getCandidateForUser(payment.candidateId, userId);
  const [scan] = payment.scanId ? await getDb().select({ verdict: scans.verdict }).from(scans).where(eq(scans.id, payment.scanId)).limit(1) : [];

  let hold: PaymentView['hold'] = null;
  if (payment.status === 'authorized' && payment.authorizationId) {
    const auth = await paypal
      .request<{ create_time?: string; expiration_time?: string }>('GET', `/v2/payments/authorizations/${encodeURIComponent(payment.authorizationId)}`)
      .catch(() => null);
    const created = new Date(auth?.create_time ?? payment.createdAt);
    const expires = auth?.expiration_time ? new Date(auth.expiration_time) : new Date(created.getTime() + 29 * DAY);
    const elapsed = Date.now() - created.getTime();
    const reauthorized = await store.hasAudit('payment', payment.id, 'authorization.reauthorized');
    hold = { honorEndsAt: new Date(created.getTime() + 3 * DAY).toISOString(), expiresAt: expires.toISOString(), canReauthorize: !reauthorized && elapsed >= 3 * DAY && elapsed < 29 * DAY };
  }

  return {
    id: payment.id,
    status: payment.status,
    mode: payment.mode,
    overrideUsed: payment.overrideUsed,
    amount: payment.amount,
    currency: payment.currency,
    storeName: candidate?.storeName ?? payment.storeSlug,
    productTitle: candidate?.productTitle ?? '',
    verdict: scan?.verdict ?? null,
    scanId: payment.scanId,
    candidateId: payment.candidateId,
    receiptSlug: await receiptSlugForPayment(payment.id),
    hold,
  };
}
