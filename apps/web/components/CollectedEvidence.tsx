import type { SignalResult } from '@voircheck/scanner';
import { fmt, type Dict } from '../lib/i18n';

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
  const hidden = collected.pages.flatMap((p) => (p.hiddenText ?? []).map((h) => ({ ...h, page: t[`kind_${p.kind}`] })));
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h4 className="text-[14px] font-medium">{t.hiddenTitle}</h4>
      <p className="mt-1 text-[13px] text-faint">{t.hiddenNote}</p>
      {hidden.length ? (
        <ul className="mb-5 mt-3 space-y-3">
          {hidden.map((h, i) => (
            <li key={i}>
              <blockquote className="border-l-2 border-line pl-3 text-[14px] leading-relaxed break-words">“{h.text}”</blockquote>
              <p className="mt-1 pl-3 text-[13px] text-muted">
                {h.possibleInjection ? <span className="mr-2 rounded-full bg-block-bg px-2 py-0.5 font-medium text-block">{t.hiddenInjection}</span> : null}
                {t[`hidden_${h.reason}`]} · {fmt(t.hiddenOn, { page: h.page })} · <code className="text-[12px]">{h.hint}</code>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-5 mt-2 text-[14px] text-muted">{t.hiddenNone}</p>
      )}
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
