import Link from 'next/link';
import type { Dict, Lang } from '../lib/i18n';
import { orderTotals, type OrderCard, type OrderStatus } from '../lib/orders-history';
import { LocalTime } from './LocalTime';
import { RefreshingRefundButton } from './RefreshingRefundButton';
import { card } from './ui';

// One neutral pill per order (verdict colours stay for verdicts).
const PILL: Record<OrderStatus, string> = {
  paid: 'bg-ink text-white',
  waiting: 'border border-ink text-ink',
  held: 'border border-ink text-ink',
  refund_pending: 'border border-dashed border-muted text-ink',
  refunded: 'border border-line bg-surface text-ink',
  expired: 'bg-surface text-muted',
  replaced: 'bg-surface text-muted',
  voided: 'bg-surface text-muted',
  not_paid: 'bg-surface text-muted',
};

const link = 'text-[13px] text-muted underline underline-offset-4 hover:text-ink';

/** History → Orders: one card per VC order with one neutral status pill (spec 5.11, Nov 3). */
export function HistoryOrders({ orders, stopped, t, lang }: { orders: OrderCard[]; stopped: Record<string, number>; t: Dict; lang: Lang }) {
  const money = (amount: number | string, currency: string) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency }).format(Number(amount));
  const totals = orderTotals(orders);
  const sum = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([c, a]) => money(a, c)).join(' · ') : money(0, 'USD'));
  const tiles: [string, string, string?][] = [
    [t.orders.paid, sum(totals.paidByCurrency)],
    [t.orders.refunded, sum(totals.refundedByCurrency)],
    [t.orders.stopped, sum(stopped), t.orders.stoppedNote],
    [t.orders.waiting, String(totals.waiting)],
  ];
  return (
    <section className="mt-6 max-w-3xl">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="rounded-control bg-surface px-4 py-3">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="mt-0.5 text-[20px] font-medium">{value}</dd>
            {note && <dd className="mt-1 text-[12px] text-faint">{note}</dd>}
          </div>
        ))}
      </dl>
      {orders.length === 0 ? (
        <p className="mt-6 text-[15px] text-muted">{t.orders.empty}</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {orders.map((o) => (
            <li key={o.paymentId} className={`${card} px-5 py-4`}>
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium">{o.store}</p>
                  <p className="truncate text-[14px] text-muted">{o.item}</p>
                  <p className="mt-0.5 text-[13px] text-faint">
                    <LocalTime at={o.at} lang={lang} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-medium">{money(o.amount, o.currency)}</p>
                  <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-medium ${PILL[o.status]}`}>{t.orders[`st_${o.status}`]}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
                {o.needsYou && (
                  <Link href={`/app/pay/${o.paymentId}`} className="text-[13px] font-medium text-ink underline underline-offset-4">
                    {o.status === 'held' ? t.orders.decide : t.orders.approve}
                  </Link>
                )}
                {o.receiptSlug && (
                  <Link href={`/r/${o.receiptSlug}`} className={link}>
                    {t.orders.receipt}
                  </Link>
                )}
                {o.scanId && (
                  <Link href={`/app/scans/${o.scanId}`} className={link}>
                    {t.orders.evidence}
                  </Link>
                )}
                <span className="ml-auto text-[12px] tracking-wide text-faint">{o.ref}</span>
                {o.refundable && (
                  <div className="basis-full">
                    <RefreshingRefundButton t={t} paymentId={o.paymentId} refLabel={o.ref} amount={money(o.amount, o.currency)} status="captured" confirmFirst />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
