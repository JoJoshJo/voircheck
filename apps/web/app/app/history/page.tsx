import { payments, scans, shoppingSessions, trustReceipts } from '@voircheck/db/schema';
import { shownPaymentStatus } from '@voircheck/paypal';
import { ownedBy } from '@voircheck/shared';
import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { LocalTime } from '../../../components/LocalTime';
import { RefundButton } from '../../../components/RefundButton';
import { RiskLogLazy } from '../../../components/RiskLogLazy';
import { card } from '../../../components/ui';
import { VerdictBadge } from '../../../components/Verdict';
import { getDb } from '../../../lib/db';
import { DICTS } from '../../../lib/i18n';
import { loadRiskLog } from '../../../lib/risk-log';
import { requireOnboardedUser } from '../../../lib/user';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const { user, lang } = await requireOnboardedUser();
  const t = DICTS[lang];
  const db = getDb();
  const riskRows = await loadRiskLog(user.id);
  const sessions = await db.select().from(shoppingSessions).where(ownedBy(shoppingSessions, user.id)).orderBy(desc(shoppingSessions.createdAt)).limit(50);
  // The latest scan of each URL at or before the request (scans are a shared cache keyed by URL).
  const rows = await Promise.all(
    sessions.map(async (s) => {
      const [scan] = s.entryType === 'link' ? await db.select({ id: scans.id, verdict: scans.verdict, score: scans.riskScore }).from(scans).where(and(eq(scans.url, s.queryOrUrl))).orderBy(desc(scans.scannedAt)).limit(1) : [];
      // Receipts of payments made in this session (payments are owned through the session, already scoped above).
      const receipts = await db
        .select({ slug: trustReceipts.publicSlug })
        .from(trustReceipts)
        .innerJoin(payments, eq(trustReceipts.paymentId, payments.id))
        .where(eq(payments.sessionId, s.id))
        .orderBy(desc(trustReceipts.createdAt));
      const sessionPayments = await db
        .select({ id: payments.id, ref: payments.ref, status: payments.status, amount: payments.amount, currency: payments.currency, createdAt: payments.createdAt })
        .from(payments)
        .where(eq(payments.sessionId, s.id))
        .orderBy(desc(payments.createdAt));
      // Orders still without a receipt: waiting for approval, or expired after PayPal's window (nothing charged).
      const open = sessionPayments.map((p) => ({ id: p.id, shown: shownPaymentStatus(p) })).filter((p) => p.shown === 'created' || p.shown === 'expired');
      // Paid orders the person can refund here (MoneyGate re-checks ownership, status and PayPal's window).
      const paid = sessionPayments.filter((p) => p.status === 'captured' || p.status === 'refund_pending' || p.status === 'refunded');
      return { s, scan, receipts, open, paid };
    }),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <h1 className="text-[28px] font-medium tracking-tight">{t.history.title}</h1>
      <section className="mt-6" aria-labelledby="risk-log-title">
        <h2 id="risk-log-title" className="text-[20px] font-medium tracking-tight">
          {t.riskLog.title}
        </h2>
        <p className="mt-1 text-[15px] text-muted">{t.riskLog.intro}</p>
        <RiskLogLazy rows={riskRows} t={t} lang={lang} />
      </section>
      <h2 className="mt-12 text-[20px] font-medium tracking-tight">{t.history.allRequests}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 text-[15px] text-muted">{t.history.empty}</p>
      ) : (
        <ul className={`${card} mt-4 max-w-3xl divide-y divide-line`}>
          {rows.map(({ s, scan, receipts, open, paid }) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-[15px]">{s.queryOrUrl}</p>
                <p className="mt-0.5 text-[13px] text-faint">
                  {s.entryType === 'link' ? t.history.link : t.history.chat} · <LocalTime at={s.createdAt.toISOString()} lang={lang} />
                </p>
                {paid.map((p) => (
                  <div key={p.id} className="mt-2">
                    <RefundButton t={t} paymentId={p.id} refLabel={p.ref} amount={new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: p.currency }).format(Number(p.amount))} status={p.status} confirmFirst />
                  </div>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {open.map((p) =>
                  p.shown === 'expired' ? (
                    <span key={p.id} className="text-[13px] text-faint">
                      {t.agent.st_expired}
                    </span>
                  ) : (
                    <Link key={p.id} href={`/app/pay/${p.id}`} className="text-[13px] text-muted underline underline-offset-4 hover:text-ink">
                      {t.agent.st_created}
                    </Link>
                  ),
                )}
                {receipts.map((r) => (
                  <Link key={r.slug} href={`/r/${r.slug}`} className="text-[13px] text-muted underline underline-offset-4 hover:text-ink">
                    {t.history.receipt}
                  </Link>
                ))}
                {scan ? (
                  <Link href={`/app/scans/${scan.id}`}>
                    <VerdictBadge verdict={scan.verdict} t={t} />
                  </Link>
                ) : (
                  <span className="text-[13px] text-faint">{t.history.notScanned}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
