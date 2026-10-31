import type { SignalResult } from '@voircheck/scanner';
import type { Dict } from '../lib/i18n';

type Collected = NonNullable<SignalResult['collected']>;

/**
 * What the scan collected for page analysis (spec 5.5 multi-page evidence), under the AI signal. Everything here
 * comes from the store's own pages: shown as plain text only (spec 5.17 #6), and URLs are not made clickable.
 */
export function CollectedEvidence({ collected, t }: { collected: Collected; t: Dict['evidence'] }) {
  const f = collected.facts;
  const none = <span className="text-faint">{t.notFound}</span>;
  const list = (xs: string[]) => (xs.length ? xs.join(' · ') : none);
  const rows: Array<[string, React.ReactNode]> = [
    [t.factCompany, list(f.companyNames)],
    [t.factAddress, list(f.addresses)],
    [t.factPhone, list(f.phones)],
    [t.factEmail, f.emails.length ? f.emails.map((e) => (e.freeMail ? `${e.address} (${t.factFreeMail})` : e.address)).join(' · ') : none],
    [t.factRegistration, list(f.registrationIds.map((r) => `${r.type}: ${r.value}`))],
    [t.factPayment, list(f.paymentMethods)],
    [t.factReturns, f.returnPolicy ? t.present : none],
    [t.factDiscounts, list(f.discountsPct.map((d) => `${d}%`))],
  ];
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h4 className="text-[14px] font-medium">{t.collectedTitle}</h4>
      <p className="mt-1 text-[13px] text-faint">{t.collectedNote}</p>
      <p className="mt-3 text-[13px] text-muted">
        {t.pagesRead}: {collected.pages.map((p) => `${t[`kind_${p.kind}`]} (${p.url})`).join(' · ')}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[14px] sm:grid-cols-[180px_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
