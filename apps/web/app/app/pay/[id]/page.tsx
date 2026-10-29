import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mascot, type MascotMood } from '../../../../components/Mascot';
import { AwaitApproval, HoldActions, PayAnyway, ShareLink } from '../../../../components/PaymentActions';
import { btnPrimary, card } from '../../../../components/ui';
import { VERDICT_CLASSES, VerdictLabel } from '../../../../components/Verdict';
import { DICTS } from '../../../../lib/i18n';
import { getPaymentView } from '../../../../lib/payment-view';
import { requireOnboardedUser } from '../../../../lib/user';

export const dynamic = 'force-dynamic';

const TITLE = { captured: 'captured', authorized: 'held', voided: 'voided', cancelled: 'cancelled', capture_pending: 'pending', capture_denied: 'denied', failed: 'denied', created: 'pending', approved: 'pending' } as const;

/** Payment step result (spec 5.11 #5): paid, HOLD (held, decide), BLOCK (voided, "Pay anyway"), cancelled. */
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, lang } = await requireOnboardedUser();
  const t = DICTS[lang];
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await getPaymentView(id, user.id);
  if (!p) notFound();

  const key = TITLE[p.status];
  const mood: MascotMood = p.verdict ?? 'idle';
  const band = p.verdict ? VERDICT_CLASSES[p.verdict] : 'bg-surface text-ink';
  const money = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: p.currency }).format(Number(p.amount));

  return (
    <main className="mx-auto max-w-2xl px-4 pb-20 sm:px-6">
      <Link href="/app" className="text-[14px] text-muted hover:text-ink">
        ← {t.pay.backToResults}
      </Link>
      <div className={`mt-5 flex items-center justify-between gap-6 rounded-card px-6 py-6 ${band}`}>
        <div className="min-w-0">
          {p.verdict && <VerdictLabel verdict={p.verdict} t={t} />}
          <h1 className="mt-1 text-[24px] font-medium tracking-tight">{t.pay[`title_${key}`]}</h1>
          <p className="mt-2 text-[15px] leading-relaxed opacity-90">{t.pay[`body_${key}`]}</p>
          {p.overrideUsed && p.status === 'captured' && <p className="mt-2 text-[13px] opacity-80">{t.pay.override_note}</p>}
        </div>
        <Mascot mood={mood} size={84} title={p.verdict ? t.verdict[p.verdict] : ''} />
      </div>

      <dl className={`${card} mt-6 grid grid-cols-3 gap-4 p-6 text-[14px]`}>
        <div>
          <dt className="text-faint">{t.pay.store}</dt>
          <dd className="mt-1 font-medium">{p.storeName}</dd>
        </div>
        <div>
          <dt className="text-faint">{t.pay.product}</dt>
          <dd className="mt-1 font-medium">{p.productTitle}</dd>
        </div>
        <div>
          <dt className="text-faint">{t.pay.price}</dt>
          <dd className="mt-1 font-medium">{money}</dd>
        </div>
      </dl>

      <section className="mt-6 space-y-5">
        {p.status === 'authorized' && <HoldActions t={t} payment={p} />}
        {(p.status === 'created' || p.status === 'approved') && <AwaitApproval t={t} paymentId={p.id} />}
        <div className="flex flex-wrap items-center gap-2">
          {p.receiptSlug && (
            <>
              <Link href={`/r/${p.receiptSlug}`} className={btnPrimary}>
                {t.pay.viewReceipt}
              </Link>
              <ShareLink t={t} path={`/r/${p.receiptSlug}`} />
            </>
          )}
          {p.scanId && (
            <Link href={`/app/scans/${p.scanId}`} className="px-3 text-[14px] text-muted underline underline-offset-4 hover:text-ink">
              {t.pay.evidence}
            </Link>
          )}
        </div>
        {p.verdict === 'BLOCK' && p.status === 'voided' && p.mode === 'approve' && p.scanId && (
          <PayAnyway t={t} lang={lang} candidateId={p.candidateId} scanId={p.scanId} />
        )}
      </section>
    </main>
  );
}
