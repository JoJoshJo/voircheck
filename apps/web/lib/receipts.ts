import 'server-only';
import { auditLog, candidates, payments, scans, shoppingSessions, trustReceipts } from '@voircheck/db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { getDb } from './db';
import type { Lang } from './i18n';
import { DEFAULT_EMAIL_FROM, deliverReceiptEmail, type ResendLike } from './receipt-mailer';
import { buildSnapshot, ReceiptSnapshot } from './receipt-snapshot';

export { actionFor, buildSnapshot, ReceiptSnapshot, type ReceiptAction } from './receipt-snapshot';

/**
 * Create or refresh the receipt for a payment (one per payment; the slug never changes). Returns the slug.
 * Called after the money decision is saved; the email is scheduled after the response and can't affect the payment.
 * `baseUrl` is the public app URL for the receipt link (APP_URL, else the request's own origin).
 */
export async function upsertPaymentReceipt(paymentId: string, lang: Lang, baseUrl: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ payment: payments, candidate: candidates, scan: scans })
    .from(payments)
    .innerJoin(candidates, eq(payments.candidateId, candidates.id))
    .innerJoin(scans, eq(payments.scanId, scans.id))
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!row) return null;
  const snapshot = buildSnapshot({ payment: row.payment, candidate: row.candidate, scan: row.scan, now: new Date() });
  if (!snapshot) return null;

  const [existing] = await db.select({ id: trustReceipts.id, slug: trustReceipts.publicSlug }).from(trustReceipts).where(eq(trustReceipts.paymentId, paymentId)).limit(1);
  let receipt: { id: string; slug: string };
  if (existing) {
    await db.update(trustReceipts).set({ snapshot, language: lang }).where(eq(trustReceipts.id, existing.id));
    receipt = existing;
  } else {
    const slug = randomBytes(18).toString('base64url'); // 144 bits: unguessable
    const [inserted] = await db
      .insert(trustReceipts)
      .values({ publicSlug: slug, paymentId, scanId: row.scan.id, language: lang, snapshot })
      .returning({ id: trustReceipts.id, slug: trustReceipts.publicSlug });
    receipt = inserted!;
  }
  scheduleReceiptEmail({ receiptId: receipt.id, slug: receipt.slug, sessionId: row.payment.sessionId, lang, snapshot, baseUrl });
  return receipt.slug;
}

// ---------- Trust Receipt email (Resend, spec 5.3 #6) ----------

let resendClient: ResendLike | null | undefined;
function getResend(): ResendLike | null {
  if (resendClient === undefined) resendClient = process.env.RESEND_API_KEY ? (new Resend(process.env.RESEND_API_KEY) as unknown as ResendLike) : null;
  return resendClient;
}

/** Runs after the response (Next `after`); outside a request (scripts) it just runs in the background. */
function scheduleReceiptEmail(input: { receiptId: string; slug: string; sessionId: string; lang: Lang; snapshot: ReceiptSnapshot; baseUrl: string }) {
  const job = () => sendReceiptEmail(input).then(() => undefined, () => undefined);
  try {
    after(job);
  } catch {
    void job();
  }
}

async function sendReceiptEmail(input: { receiptId: string; slug: string; sessionId: string; lang: Lang; snapshot: ReceiptSnapshot; baseUrl: string }) {
  const db = getDb();
  // The payment owner's account email (Neon Auth). Read server-side only; never stored in the receipt or audit log.
  const [owner] = await db.select({ userId: shoppingSessions.userId }).from(shoppingSessions).where(eq(shoppingSessions.id, input.sessionId)).limit(1);
  const result = owner ? await db.execute<{ email: string | null }>(sql`select email from neon_auth."user" where id = ${owner.userId} limit 1`) : null;
  const to = (result?.rows?.[0]?.email as string | null | undefined) ?? null;

  return deliverReceiptEmail(
    { receiptId: input.receiptId, slug: input.slug, to, lang: input.lang, snapshot: input.snapshot, baseUrl: input.baseUrl },
    {
      resend: getResend(),
      from: process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
      claim: async () =>
        (await db.update(trustReceipts).set({ emailedAt: new Date() }).where(and(eq(trustReceipts.id, input.receiptId), isNull(trustReceipts.emailedAt))).returning({ id: trustReceipts.id }))
          .length === 1,
      release: async () => {
        await db.update(trustReceipts).set({ emailedAt: null }).where(eq(trustReceipts.id, input.receiptId));
      },
      audit: async (action, details) => {
        await db.insert(auditLog).values({ userId: owner?.userId ?? null, actor: 'system', action, entity: 'trust_receipt', entityId: input.receiptId, details });
      },
    },
  );
}

export async function getReceiptBySlug(slug: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(slug)) return null;
  const [row] = await getDb()
    .select({ snapshot: trustReceipts.snapshot, language: trustReceipts.language, createdAt: trustReceipts.createdAt })
    .from(trustReceipts)
    .where(eq(trustReceipts.publicSlug, slug))
    .orderBy(desc(trustReceipts.createdAt))
    .limit(1);
  if (!row) return null;
  const parsed = ReceiptSnapshot.safeParse(row.snapshot);
  return parsed.success ? { snapshot: parsed.data, language: row.language } : null;
}

export async function receiptSlugForPayment(paymentId: string): Promise<string | null> {
  const [r] = await getDb().select({ slug: trustReceipts.publicSlug }).from(trustReceipts).where(eq(trustReceipts.paymentId, paymentId)).limit(1);
  return r?.slug ?? null;
}
