import 'server-only';
import type { Db } from '@voircheck/db';
import { auditLog, candidates, payments, scans, shoppingSessions, trustReceipts } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { getDb } from './db';
import { toOrderCards, type OrderCard } from './orders-history';
import { toRiskRows, type LinkCheckRecord, type PaymentRecord, type RiskRow } from './risk-log-map';
import { stoppedBeforePaying, type RefusedOffer } from './stopped';

/** Newest first; enough for a person's history during the hackathon (the grid sorts and filters in the browser). */
export const RISK_LOG_LIMIT = 200;

/**
 * The person's own payments (owned through shopping_sessions, like every payment read), with the store and item
 * from our candidate row, the scan the decision used, and the receipt if there is one.
 */
export function paymentRecordsQuery(db: Db, userId: string) {
  return db
    .select({
      paymentId: payments.id,
      sessionId: payments.sessionId,
      ref: payments.ref,
      status: payments.status,
      overrideUsed: payments.overrideUsed,
      amount: payments.amount,
      currency: payments.currency,
      createdAt: payments.createdAt,
      storeName: candidates.storeName,
      storeUrl: candidates.storeUrl,
      productTitle: candidates.productTitle,
      scanId: payments.scanId,
      verdict: scans.verdict,
      riskScore: scans.riskScore,
      signals: scans.signals,
      receiptSlug: trustReceipts.publicSlug,
    })
    .from(payments)
    .innerJoin(shoppingSessions, eq(payments.sessionId, shoppingSessions.id))
    .innerJoin(candidates, eq(payments.candidateId, candidates.id))
    .leftJoin(scans, eq(payments.scanId, scans.id))
    .leftJoin(trustReceipts, eq(trustReceipts.paymentId, payments.id))
    .where(ownedBy(shoppingSessions, userId))
    .orderBy(desc(payments.createdAt))
    .limit(RISK_LOG_LIMIT);
}

/**
 * The person's own link checks: the session, its candidate and the latest scan of that URL (scans are a shared
 * per-URL cache; the session decides whose row it is).
 */
export function linkChecksQuery(db: Db, userId: string) {
  return db
    .selectDistinctOn([shoppingSessions.createdAt, shoppingSessions.id], {
      sessionId: shoppingSessions.id,
      createdAt: shoppingSessions.createdAt,
      url: shoppingSessions.queryOrUrl,
      storeName: candidates.storeName,
      productTitle: candidates.productTitle,
      price: candidates.price,
      currency: candidates.currency,
      scanId: scans.id,
      verdict: scans.verdict,
      riskScore: scans.riskScore,
      signals: scans.signals,
    })
    .from(shoppingSessions)
    .leftJoin(candidates, eq(candidates.sessionId, shoppingSessions.id))
    .leftJoin(scans, eq(scans.url, shoppingSessions.queryOrUrl))
    .where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.entryType, 'link')))
    .orderBy(desc(shoppingSessions.createdAt), shoppingSessions.id, desc(scans.scannedAt))
    .limit(RISK_LOG_LIMIT);
}

/**
 * BLOCK offers VoirCheck refused before any order existed: the agent's create_order (reason "block") and Auto-pay
 * (verdict BLOCK), from the append-only audit log, joined to the person's own candidate for the store and price.
 */
export function refusedOffersQuery(db: Db, userId: string) {
  return db
    .selectDistinct({ sessionId: candidates.sessionId, storeUrl: candidates.storeUrl, price: candidates.price, currency: candidates.currency })
    .from(auditLog)
    .innerJoin(candidates, sql`${auditLog.details}->>'candidateId' = ${candidates.id}::text`)
    .innerJoin(shoppingSessions, eq(candidates.sessionId, shoppingSessions.id))
    .where(
      ownedBy(
        shoppingSessions,
        userId,
        eq(auditLog.userId, userId),
        or(
          and(eq(auditLog.action, 'agent.order_refused'), sql`${auditLog.details}->>'reason' = 'block'`),
          and(eq(auditLog.action, 'autopay.refused'), sql`${auditLog.details}->>'verdict' = 'BLOCK'`),
        ),
      ),
    )
    .limit(RISK_LOG_LIMIT);
}

export async function loadRiskLog(userId: string): Promise<RiskRow[]> {
  const db = getDb();
  const [paid, checks] = await Promise.all([paymentRecordsQuery(db, userId), linkChecksQuery(db, userId)]);
  return toRiskRows(paid as PaymentRecord[], checks as LinkCheckRecord[]);
}

/** History: the risk log (Checks tab), one card per order (Orders tab) and "Stopped before paying" (both tabs). */
export async function loadHistory(userId: string): Promise<{ riskRows: RiskRow[]; orders: OrderCard[]; stopped: Record<string, number> }> {
  const db = getDb();
  const [paid, checks, refused] = await Promise.all([paymentRecordsQuery(db, userId), linkChecksQuery(db, userId), refusedOffersQuery(db, userId)]);
  return {
    riskRows: toRiskRows(paid as PaymentRecord[], checks as LinkCheckRecord[]),
    orders: toOrderCards(paid as PaymentRecord[]),
    stopped: stoppedBeforePaying(paid as PaymentRecord[], refused as RefusedOffer[]),
  };
}
