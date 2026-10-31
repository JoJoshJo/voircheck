import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CollectedEvidence } from '../../../../components/CollectedEvidence';
import { Mascot } from '../../../../components/Mascot';
import { SignalIcon } from '../../../../components/SignalIcon';
import { card } from '../../../../components/ui';
import { VERDICT_CLASSES, VerdictLabel } from '../../../../components/Verdict';
import { DICTS, fmt } from '../../../../lib/i18n';
import { getScanForUser } from '../../../../lib/scans';
import { toScanView } from '../../../../lib/scan-view';
import { requireOnboardedUser } from '../../../../lib/user';

export const dynamic = 'force-dynamic';

/** Store evidence view (spec 5.11 #4). Evidence strings are rendered as plain text, never HTML (spec 5.17 #6). */
export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { user, lang } = await requireOnboardedUser();
  const t = DICTS[lang];
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await getScanForUser(id, user.id);
  if (!row) notFound();
  const scan = toScanView(row);
  const when = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scan.scannedAt));

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
      <Link href="/app" className="text-[14px] text-muted hover:text-ink">
        ← {t.evidence.back}
      </Link>
      <div className={`mt-5 flex items-center justify-between gap-6 rounded-card px-6 py-6 ${VERDICT_CLASSES[scan.verdict]}`}>
        <div className="min-w-0">
          <VerdictLabel verdict={scan.verdict} t={t} />
          <h1 className="mt-1 text-[22px] font-medium tracking-tight">{t.verdict[`${scan.verdict}_line`]}</h1>
          <p className="mt-1 truncate text-[14px] opacity-80">{scan.url}</p>
          <p className="mt-1 text-[13px] opacity-80">
            {t.workspace.score}: {scan.score}/100 · {fmt(t.evidence.scannedAt, { when })}
          </p>
        </div>
        <Mascot mood={scan.verdict} size={88} title={t.verdict[scan.verdict]} />
      </div>

      <section className={`${card} mt-6 p-6`}>
        <h2 className="text-[15px] font-medium">{t.evidence.hardRules}</h2>
        <p className="mt-2 text-[15px] text-muted">{scan.hardRules.length ? scan.hardRules.map((r) => t.evidence[`rule_${r}`]).join(' · ') : t.evidence.none}</p>
        <p className="mt-4 text-[13px] text-faint">{t.evidence.explanationSoon}</p>
      </section>

      <h2 className="mb-3 mt-10 text-[17px] font-medium">{t.evidence.title}</h2>
      <ul className="space-y-3">
        {scan.signals.map((s) => (
          <li key={s.id} className={`${card} p-5`}>
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-[15px] font-medium">{t.signals[s.id]}</h3>
              <span className="flex items-center gap-2 text-[13px] text-muted">
                {t.signals[`status_${s.status}`]} · {fmt(t.evidence.points, { n: s.points })}
                <SignalIcon state={s.status} />
              </span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {s.evidence.map((e, i) => (
                <li key={i} className="text-[14px] leading-relaxed text-muted">
                  {e}
                </li>
              ))}
            </ul>
            {s.id === 'ai_page' && s.collected ? <CollectedEvidence collected={s.collected} t={t.evidence} /> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
