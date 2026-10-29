import type { Metadata } from 'next';
import { Logo } from '../../../components/Logo';
import { Mascot } from '../../../components/Mascot';
import { ShareLink } from '../../../components/PaymentActions';
import { SignalIcon, type SignalState } from '../../../components/SignalIcon';
import { card } from '../../../components/ui';
import { VERDICT_CLASSES, VerdictLabel } from '../../../components/Verdict';
import { DICTS, fmt, isLang } from '../../../lib/i18n';
import { getReceiptBySlug } from '../../../lib/receipts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Trust Receipt', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** Public Trust Receipt (spec 5.9): no login, no personal info, plain text only. */
export default async function ReceiptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await getReceiptBySlug(slug);
  if (!r) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <Mascot mood="HOLD" size={72} />
        <p className="text-[15px] text-muted">{DICTS.en.receipt.notFound}</p>
      </main>
    );
  }
  const lang = isLang(r.language) ? r.language : 'en';
  const t = DICTS[lang];
  const s = r.snapshot;
  const when = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(s.actionAt));
  const money = s.amount ? new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: s.currency }).format(Number(s.amount)) : null;

  return (
    <main lang={lang} className="mx-auto max-w-2xl px-4 pb-20 pt-8 sm:px-6">
      <div className="flex items-center justify-between">
        <Logo />
        <ShareLink t={t} path={`/r/${slug}`} />
      </div>
      <p className="mt-10 text-[13px] font-medium uppercase tracking-[0.08em] text-faint">{t.receipt.title}</p>
      <div className={`mt-3 flex items-center justify-between gap-6 rounded-card px-6 py-6 ${VERDICT_CLASSES[s.verdict]}`}>
        <div className="min-w-0">
          <VerdictLabel verdict={s.verdict} t={t} />
          <h1 className="mt-1 text-[24px] font-medium tracking-tight">{s.storeName}</h1>
          <p className="mt-1 text-[14px] opacity-80">
            {s.storeHost} · {t.workspace.score}: {s.score}/100
          </p>
        </div>
        <Mascot mood={s.verdict} size={84} title={t.verdict[s.verdict]} />
      </div>

      <dl className={`${card} mt-6 grid gap-4 p-6 text-[14px] sm:grid-cols-3`}>
        <div>
          <dt className="text-faint">{t.receipt.action}</dt>
          <dd className="mt-1 font-medium">{t.receipt[`action_${s.action}`]}</dd>
        </div>
        <div>
          <dt className="text-faint">{t.pay.product}</dt>
          <dd className="mt-1 font-medium">{s.productTitle}</dd>
        </div>
        {money && (
          <div>
            <dt className="text-faint">{t.receipt.amount}</dt>
            <dd className="mt-1 font-medium">{money}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-[13px] text-faint">{fmt(t.receipt.when, { when })}</p>

      <section className={`${card} mt-6 p-6`}>
        <h2 className="text-[15px] font-medium">{t.evidence.hardRules}</h2>
        <p className="mt-2 text-[14px] text-muted">{s.hardRules.length ? s.hardRules.map((h) => t.evidence[`rule_${h}` as keyof typeof t.evidence] ?? h).join(' · ') : t.evidence.none}</p>
      </section>

      <h2 className="mb-3 mt-8 text-[17px] font-medium">{t.receipt.checks}</h2>
      <ul className={`${card} divide-y divide-line`}>
        {s.signals.map((sig) => (
          <li key={sig.id} className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[15px]">{t.signals[sig.id as keyof typeof t.signals] ?? sig.id}</p>
              {sig.summary && <p className="mt-1 text-[13px] leading-relaxed text-muted">{sig.summary}</p>}
            </div>
            <SignalIcon state={sig.status as SignalState} />
          </li>
        ))}
      </ul>
      <p className="mt-10 text-center text-[12px] text-faint">{t.receipt.footer}</p>
    </main>
  );
}
