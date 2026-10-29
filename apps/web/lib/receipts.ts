import 'server-only';
import { candidates, payments, scans, trustReceipts } from '@voircheck/db/schema';
import { desc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getDb } from './db';
import type { Lang } from './i18n';
import { buildSnapshot, ReceiptSnapshot } from './receipt-snapshot';

export { actionFor, buildSnapshot, ReceiptSnapshot, type ReceiptAction } from './receipt-snapshot';

/** Create or refresh the receipt for a payment (one per payment; the slug never changes). Returns the slug. */
export async function upsertPaymentReceipt(paymentId: string, lang: Lang): Promise<string | null> {
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
  if (existing) {
    await db.update(trustReceipts).set({ snapshot, language: lang }).where(eq(trustReceipts.id, existing.id));
    return existing.slug;
  }
  const slug = randomBytes(18).toString('base64url'); // 144 bits: unguessable
  await db.insert(trustReceipts).values({ publicSlug: slug, paymentId, scanId: row.scan.id, language: lang, snapshot });
  await emailReceipt(slug);
  return slug;
}

/**
 * Email copy of the receipt (spec 5.3 #6). Hook only: Resend is set up later (RESEND_API_KEY). It will send the
 * receipt link to the signed-in user's own address; the receipt itself stays free of personal info.
 */
export async function emailReceipt(slug: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return; // not set up yet
  // TODO(Resend): look up the payment owner's email server-side and send this link.
  console.info(`receipt email pending Resend setup: /r/${slug.slice(0, 4)}…`);
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
