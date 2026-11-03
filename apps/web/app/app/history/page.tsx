import { scans, shoppingSessions } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { LocalTime } from '../../../components/LocalTime';
import { HistoryOrders } from '../../../components/HistoryOrders';
import { RiskLogLazy } from '../../../components/RiskLogLazy';
import { card } from '../../../components/ui';
import { VerdictBadge } from '../../../components/Verdict';
import { getDb } from '../../../lib/db';
import { DICTS, type Dict, type Lang } from '../../../lib/i18n';
import { loadHistory } from '../../../lib/risk-log';
import { requireOnboardedUser } from '../../../lib/user';

export const dynamic = 'force-dynamic';


export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { user, lang } = await requireOnboardedUser();
  const t = DICTS[lang];
  const tab = (await searchParams).tab === 'checks' ? 'checks' : 'orders';
  const { riskRows, orders, stopped } = await loadHistory(user.id);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
      <h1 className="text-[28px] font-medium tracking-tight">{t.history.title}</h1>
      <nav className="mt-5 flex gap-1 border-b border-line" aria-label={t.history.title}>
        {(['orders', 'checks'] as const).map((k) => (
          <Link key={k} href={k === 'orders' ? '/app/history' : '/app/history?tab=checks'} aria-current={tab === k ? 'page' : undefined} className={`-mb-px border-b-2 px-3.5 py-2.5 text-[15px] ${tab === k ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {k === 'orders' ? t.orders.tabOrders : t.orders.tabChecks}
          </Link>
        ))}
      </nav>
      {tab === 'orders' ? <HistoryOrders orders={orders} stopped={stopped} t={t} lang={lang} /> : <Checks userId={user.id} riskRows={riskRows} stopped={stopped} t={t} lang={lang} />}
    </main>
  );
}

async function Checks({ userId, riskRows, stopped, t, lang }: { userId: string; riskRows: Awaited<ReturnType<typeof loadHistory>>['riskRows']; stopped: Record<string, number>; t: Dict; lang: Lang }) {
  const db = getDb();
  const sessions = await db.select().from(shoppingSessions).where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.entryType, 'link'))).orderBy(desc(shoppingSessions.createdAt)).limit(50);
  // The latest scan of each URL (scans are a shared cache keyed by URL; the session decides whose row it is).
  const rows = await Promise.all(
    sessions.map(async (s) => {
      const [scan] = await db.select({ id: scans.id, verdict: scans.verdict }).from(scans).where(eq(scans.url, s.queryOrUrl)).orderBy(desc(scans.scannedAt)).limit(1);
      return { s, scan };
    }),
  );
  return (
    <>
      <section className="mt-6" aria-labelledby="risk-log-title">
        <h2 id="risk-log-title" className="text-[20px] font-medium tracking-tight">
          {t.riskLog.title}
        </h2>
        <p className="mt-1 text-[15px] text-muted">{t.riskLog.intro}</p>
        <RiskLogLazy rows={riskRows} stopped={stopped} t={t} lang={lang} />
      </section>
      <h2 className="mt-12 text-[20px] font-medium tracking-tight">{t.orders.linkChecks}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 text-[15px] text-muted">{t.orders.linkChecksEmpty}</p>
      ) : (
        <ul className={`${card} mt-4 max-w-3xl divide-y divide-line`}>
          {rows.map(({ s, scan }) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-[15px]">{s.queryOrUrl}</p>
                <p className="mt-0.5 text-[13px] text-faint">
                  <LocalTime at={s.createdAt.toISOString()} lang={lang} />
                </p>
              </div>
              {scan ? (
                <Link href={`/app/scans/${scan.id}`}>
                  <VerdictBadge verdict={scan.verdict} t={t} />
                </Link>
              ) : (
                <span className="text-[13px] text-faint">{t.history.notScanned}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
