import 'server-only';
import { candidates, payments, shoppingSessions } from '@voircheck/db/schema';
import type { RecentOrdersOutput } from '@voircheck/agent';
import { decideRefund, scanCoversStore, shownPaymentStatus } from '@voircheck/paypal';
import { ownedBy } from '@voircheck/shared';
import { desc, eq } from 'drizzle-orm';
import { getDb } from './db';

/** The ID of the person's own payment with this VoirCheck reference (VC-7K2F), or null. Never someone else's. */
export async function paymentIdForRef(ref: string, userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(shoppingSessions, eq(payments.sessionId, shoppingSessions.id))
    .where(ownedBy(shoppingSessions, userId, eq(payments.ref, ref)))
    .limit(1);
  return row?.id ?? null;
}

/** The person's own 10 most recent orders, as the agent's list_my_recent_orders sees them (our rows only). */
export async function recentOrdersForUser(userId: string): Promise<RecentOrdersOutput> {
  const rows = await getDb()
    .select({ ref: payments.ref, store: candidates.storeName, item: candidates.productTitle, amount: payments.amount, currency: payments.currency, status: payments.status, createdAt: payments.createdAt })
    .from(payments)
    .innerJoin(shoppingSessions, eq(payments.sessionId, shoppingSessions.id))
    .innerJoin(candidates, eq(payments.candidateId, candidates.id))
    .where(ownedBy(shoppingSessions, userId))
    .orderBy(desc(payments.createdAt))
    .limit(10);
  return {
    orders: rows.map((r) => ({
      ref: r.ref,
      store: r.store.slice(0, 80),
      item: r.item.slice(0, 120),
      amount: Number(r.amount).toFixed(2),
      currency: r.currency,
      status: statusForAgent(shownPaymentStatus(r)),
      date: r.createdAt.toISOString().slice(0, 10),
    })),
  };
}

const statusForAgent = (s: string) => (s === 'created' ? 'waiting_for_buyer' : s) as RecentOrdersOutput['orders'][number]['status'];

/**
 * The person's own paid orders at the store this scan covers that can still be refunded (newest first, references
 * only). Lets the agent offer a refund when a store they paid now scans BLOCK.
 */
export async function refundableRefsAtStore(userId: string, scanUrl: string, now = new Date()): Promise<string[]> {
  const rows = await getDb()
    .select({ ref: payments.ref, status: payments.status, captureId: payments.captureId, createdAt: payments.createdAt, storeUrl: candidates.storeUrl })
    .from(payments)
    .innerJoin(shoppingSessions, eq(payments.sessionId, shoppingSessions.id))
    .innerJoin(candidates, eq(payments.candidateId, candidates.id))
    .where(ownedBy(shoppingSessions, userId, eq(payments.status, 'captured')))
    .orderBy(desc(payments.createdAt))
    .limit(50);
  return rows
    .filter((r) => scanCoversStore(scanUrl, r.storeUrl) && decideRefund({ status: 'captured', captureId: r.captureId, createdAt: r.createdAt }, now).allowed)
    .map((r) => r.ref)
    .slice(0, 5);
}
