import type { Db } from '@voircheck/db';
import { auditLog, candidates, payments, profiles, scans, shoppingSessions, vaultTokens, webhookEvents } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { CandidateRow, GateStore, NewPayment, PaymentPatch, PaymentRow, PaymentStatus, WebhookRecordState } from './store';

/**
 * GateStore on Neon via Drizzle. candidates and payments have no user_id of their own: they're owned through
 * shopping_sessions, so every user-scoped read joins it and filters with ownedBy (spec 5.9 / 5.17).
 */
export function drizzleGateStore(db: Db): GateStore {
  const paymentCols = {
    id: payments.id,
    userId: shoppingSessions.userId,
    sessionId: payments.sessionId,
    candidateId: payments.candidateId,
    scanId: payments.scanId,
    paypalOrderId: payments.paypalOrderId,
    authorizationId: payments.authorizationId,
    captureId: payments.captureId,
    storeSlug: payments.storeSlug,
    amount: payments.amount,
    currency: payments.currency,
    status: payments.status,
    mode: payments.mode,
    overrideUsed: payments.overrideUsed,
    createdAt: payments.createdAt,
  };
  const asPayment = (r: Omit<PaymentRow, 'status'> & { status: string }): PaymentRow => ({ ...r, status: r.status as PaymentStatus });
  const paymentQuery = () => db.select(paymentCols).from(payments).innerJoin(shoppingSessions, eq(payments.sessionId, shoppingSessions.id));

  const store: GateStore = {
    async getCandidateForUser(candidateId, userId) {
      const [row] = await db
        .select({
          id: candidates.id,
          sessionId: candidates.sessionId,
          userId: shoppingSessions.userId,
          storeName: candidates.storeName,
          storeUrl: candidates.storeUrl,
          productTitle: candidates.productTitle,
          price: candidates.price,
          currency: candidates.currency,
          source: candidates.source,
        })
        .from(candidates)
        .innerJoin(shoppingSessions, eq(candidates.sessionId, shoppingSessions.id))
        .where(ownedBy(shoppingSessions, userId, eq(candidates.id, candidateId)))
        .limit(1);
      return (row as CandidateRow | undefined) ?? null;
    },
    async getScan(scanId) {
      const [row] = await db
        .select({ id: scans.id, url: scans.url, verdict: scans.verdict, riskScore: scans.riskScore, scannedAt: scans.scannedAt, cacheExpiresAt: scans.cacheExpiresAt })
        .from(scans)
        .where(eq(scans.id, scanId))
        .limit(1);
      return row ?? null;
    },
    async getProfile(userId) {
      const [row] = await db
        .select({ userId: profiles.userId, autopayEnabled: profiles.autopayEnabled, autopayLimit: profiles.autopayLimit })
        .from(profiles)
        .where(ownedBy(profiles, userId))
        .limit(1);
      return row ?? null;
    },
    async getActiveVaultToken(userId) {
      const [row] = await db
        .select({ paypalVaultTokenId: vaultTokens.paypalVaultTokenId })
        .from(vaultTokens)
        .where(ownedBy(vaultTokens, userId, eq(vaultTokens.status, 'VAULTED')))
        .orderBy(desc(vaultTokens.createdAt))
        .limit(1);
      return row ?? null;
    },
    async saveVaultToken(userId, paypalVaultTokenId, status) {
      await db
        .insert(vaultTokens)
        .values({ userId, paypalVaultTokenId, status })
        .onConflictDoUpdate({ target: vaultTokens.paypalVaultTokenId, set: { status } });
    },
    async getPaymentForUser(paymentId, userId) {
      const [row] = await paymentQuery().where(ownedBy(shoppingSessions, userId, eq(payments.id, paymentId))).limit(1);
      return row ? asPayment(row) : null;
    },
    async getPaymentByOrderId(orderId) {
      const [row] = await paymentQuery().where(eq(payments.paypalOrderId, orderId)).limit(1);
      return row ? asPayment(row) : null;
    },
    async insertPayment(row: NewPayment) {
      const { userId, ...values } = row;
      await db.insert(payments).values(values).onConflictDoNothing({ target: payments.paypalOrderId });
      const saved = await store.getPaymentByOrderId(row.paypalOrderId);
      if (!saved || saved.userId !== userId) throw new Error('payment insert failed ownership check');
      return saved;
    },
    async updatePayment(paymentId, patch: PaymentPatch) {
      await db.update(payments).set(patch).where(eq(payments.id, paymentId));
      const [row] = await paymentQuery().where(eq(payments.id, paymentId)).limit(1);
      if (!row) throw new Error(`payment ${paymentId} not found`);
      return asPayment(row);
    },
    async appendAudit(entry) {
      await db.insert(auditLog).values(entry);
    },
    async hasAudit(entity, entityId, action) {
      const [row] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, entityId), eq(auditLog.action, action)))
        .limit(1);
      return !!row;
    },
    async recordWebhookEvent(e): Promise<WebhookRecordState> {
      const inserted = await db
        .insert(webhookEvents)
        .values({ paypalEventId: e.paypalEventId, eventType: e.eventType, signatureVerified: e.signatureVerified, payload: e.payload })
        .onConflictDoNothing({ target: webhookEvents.paypalEventId })
        .returning({ id: webhookEvents.id });
      if (inserted.length) return 'new';
      const [done] = await db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(and(eq(webhookEvents.paypalEventId, e.paypalEventId), isNotNull(webhookEvents.processedAt)))
        .limit(1);
      return done ? 'processed' : 'unprocessed';
    },
    async markWebhookProcessed(paypalEventId) {
      await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.paypalEventId, paypalEventId));
    },
  };
  return store;
}
