'use client';

import { AG_GRID_LOCALE_FR } from '@ag-grid-community/locale';
import {
  CellStyleModule,
  ClientSideRowModelModule,
  enableDevValidations,
  ExternalFilterModule,
  LocaleModule,
  NumberFilterModule,
  PaginationModule,
  QuickFilterModule,
  TextFilterModule,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type IRowNode,
  type Module,
} from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dict, Lang } from '../lib/i18n';
import { OUTCOMES, passesFilters, SIGNAL_ORDER, summarize, type Outcome, type RiskFilters, type RiskRow, type Verdict } from '../lib/risk-log-map';
import { formatWhen } from '../lib/when';
import { Summary, VerdictChart } from './RiskCharts';
import { input, label as labelClass } from './ui';

/**
 * History risk log (AG Grid Community + AG Charts Community in RiskCharts, MIT; no Enterprise modules, no licence key). Loaded only on the History page,
 * in the browser (RiskLogLazy). Everything shown comes from our own rows, as plain text.
 */

// Only the Community modules this grid uses (keeps the bundle small; AllCommunityModule would register them all).
const GRID_MODULES: Module[] = [ClientSideRowModelModule, TextFilterModule, NumberFilterModule, QuickFilterModule, ExternalFilterModule, PaginationModule, LocaleModule, CellStyleModule];
if (process.env.NODE_ENV !== 'production') enableDevValidations();

// Mono ink (spec 5.12) through the Theming API: white, #F5F5F4 surfaces, #E7E5E4 borders, #0C0C0C ink, no accent.
const gridTheme = themeQuartz.withParams({
  browserColorScheme: 'light',
  backgroundColor: '#FFFFFF',
  foregroundColor: '#0C0C0C',
  textColor: '#0C0C0C',
  subtleTextColor: '#6B6866',
  borderColor: '#E7E5E4',
  rowBorder: { color: '#E7E5E4' },
  columnBorder: false,
  headerBackgroundColor: '#F5F5F4',
  headerTextColor: '#6B6866',
  headerFontWeight: 500,
  headerFontSize: 13,
  accentColor: '#0C0C0C',
  rowHoverColor: '#F5F5F4',
  selectedRowBackgroundColor: '#F5F5F4',
  fontFamily: 'inherit',
  fontSize: 14,
  spacing: 6,
  cellHorizontalPadding: 12,
  rowHeight: 48,
  headerHeight: 40,
  wrapperBorder: { color: '#E7E5E4' },
  wrapperBorderRadius: 16,
  borderRadius: 8,
  inputBorder: { color: '#E7E5E4' },
  inputFocusBorder: { color: '#0C0C0C' },
  focusShadow: 'none',
});

export const VERDICT_STYLE: Record<Verdict, { bg: string; fg: string }> = {
  SAFE: { bg: '#EAF3DE', fg: '#27500A' },
  HOLD: { bg: '#FAEEDA', fg: '#633806' },
  BLOCK: { bg: '#FCEBEB', fg: '#791F1F' },
};
const VERDICT_RANK: Record<Verdict, number> = { SAFE: 0, HOLD: 1, BLOCK: 2 };

function VerdictPill({ verdict, t }: { verdict: Verdict | null; t: Dict }) {
  if (!verdict) return <span className="text-[13px] text-faint">{t.riskLog.notScanned}</span>;
  const s = VERDICT_STYLE[verdict];
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium leading-5" style={{ background: s.bg, color: s.fg }}>
      {t.verdict[verdict]}
    </span>
  );
}

const MARK = { pass: '✓', warn: '–', fail: '✕', unavailable: '–' } as const; // same marks as SignalIcon: amber – a bit off, grey – not checked
const MARK_STYLE = { pass: VERDICT_STYLE.SAFE, warn: VERDICT_STYLE.HOLD, fail: VERDICT_STYLE.BLOCK, unavailable: { bg: '#F5F5F4', fg: '#A8A29E' } } as const;

function Signals({ signals, t }: { signals: RiskRow['signals']; t: Dict }) {
  return (
    <span className="inline-flex items-center gap-1">
      {SIGNAL_ORDER.map((id) => {
        const st = signals[id] ?? 'unavailable';
        const text = `${t.signals[id]}: ${t.signals[`status_${st}`]}`;
        return (
          <span key={id} title={text} aria-label={text} role="img" className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-medium" style={{ background: MARK_STYLE[st].bg, color: MARK_STYLE[st].fg }}>
            {MARK[st]}
          </span>
        );
      })}
    </span>
  );
}

function Links({ row, t }: { row: RiskRow; t: Dict }) {
  const cls = 'text-[13px] text-muted underline underline-offset-4 hover:text-ink';
  return (
    <span className="inline-flex gap-3">
      {row.receiptSlug ? (
        <Link href={`/r/${row.receiptSlug}`} className={cls}>
          {t.riskLog.receipt}
        </Link>
      ) : row.paymentId && (row.outcome === 'waiting' || row.outcome === 'held') ? (
        <Link href={`/app/pay/${row.paymentId}`} className={cls}>
          {t.riskLog.payment}
        </Link>
      ) : null}
      {row.scanId && (
        <Link href={`/app/scans/${row.scanId}`} className={cls}>
          {t.riskLog.evidence}
        </Link>
      )}
    </span>
  );
}

/** Phone: a simple list. Laptop under 1200px: the grid without the item and risk columns. Wider: every column. */
function useLayout(): 'list' | 'compact' | 'full' {
  const [layout, setLayout] = useState<'list' | 'compact' | 'full'>('full');
  useEffect(() => {
    const list = window.matchMedia('(max-width: 767px)');
    const compact = window.matchMedia('(max-width: 1199px)');
    const on = () => setLayout(list.matches ? 'list' : compact.matches ? 'compact' : 'full');
    on();
    list.addEventListener('change', on);
    compact.addEventListener('change', on);
    return () => {
      list.removeEventListener('change', on);
      compact.removeEventListener('change', on);
    };
  }, []);
  return layout;
}

/** "Nov 3, 12:10 PM" in the viewer's own zone; the zone is named once, in the column header (zoneName). */
function shortWhen(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

/** The viewer's zone as a short name ("EST", "UTC−5"), for the Date header. */
function zoneName(locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

export default function RiskLog({ rows, stopped, t, lang }: { rows: RiskRow[]; stopped: Record<string, number>; t: Dict; lang: Lang }) {
  const layout = useLayout();
  const [quick, setQuick] = useState('');
  const [filters, setFilters] = useState<RiskFilters>({ verdict: null, outcome: null, from: null, to: null });
  const filtersRef = useRef(filters);
  const grid = useRef<AgGridReact<RiskRow>>(null);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';

  useEffect(() => {
    filtersRef.current = filters;
    grid.current?.api?.onFilterChanged();
  }, [filters]);

  const money = (amount: number | null, currency: string) => (amount == null ? '–' : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount));
  const outcomeLabel = (o: Outcome) => t.riskLog[`out_${o}`];
  const summary = useMemo(() => summarize(rows), [rows]);

  const columnDefs = useMemo<ColDef<RiskRow>[]>(
    () => [
      {
        colId: 'at',
        headerName: `${t.riskLog.colDate} (${zoneName(locale)})`,
        valueGetter: (p) => (p.data ? new Date(p.data.at) : null),
        valueFormatter: (p) => (p.value ? shortWhen(p.value as Date, locale) : ''),
        getQuickFilterText: () => '',
        filter: false, // the From/To day inputs above the grid filter dates (in the viewer's zone)
        sort: 'desc',
        width: 136,
      },
      { field: 'ref', headerName: t.riskLog.colRef, width: 96, valueFormatter: (p) => p.value ?? '–', filter: false },
      { field: 'store', headerName: t.riskLog.colStore, flex: 1.3, minWidth: 110, filter: 'agTextColumnFilter' },
      { field: 'product', headerName: t.riskLog.colProduct, flex: 1, minWidth: 96, filter: 'agTextColumnFilter', hide: layout !== 'full' },
      {
        field: 'amount',
        headerName: t.riskLog.colAmount,
        type: 'rightAligned',
        width: 108,
        filter: 'agNumberColumnFilter',
        valueFormatter: (p) => (p.data ? money(p.data.amount, p.data.currency) : ''),
      },
      {
        field: 'verdict',
        headerName: t.riskLog.colVerdict,
        width: 108,
        filter: false,
        comparator: (a: Verdict | null, b: Verdict | null) => (a ? VERDICT_RANK[a] : -1) - (b ? VERDICT_RANK[b] : -1),
        getQuickFilterText: (p) => (p.data?.verdict ? t.verdict[p.data.verdict] : ''),
        cellRenderer: (p: ICellRendererParams<RiskRow>) => (p.data ? <VerdictPill verdict={p.data.verdict} t={t} /> : null),
      },
      { field: 'score', headerName: t.riskLog.colScore, type: 'rightAligned', width: 72, hide: layout !== 'full', filter: false, valueFormatter: (p) => (p.value == null ? '–' : String(p.value)) },
      {
        colId: 'signals',
        headerName: t.riskLog.colSignals,
        width: 152,
        sortable: false,
        filter: false,
        getQuickFilterText: () => '',
        cellRenderer: (p: ICellRendererParams<RiskRow>) => (p.data ? <Signals signals={p.data.signals} t={t} /> : null),
      },
      {
        field: 'outcome',
        headerName: t.riskLog.colOutcome,
        width: 156,
        filter: false,
        valueFormatter: (p) => (p.value ? outcomeLabel(p.value as Outcome) : ''),
        getQuickFilterText: (p) => (p.data ? outcomeLabel(p.data.outcome) : ''),
      },
      {
        colId: 'links',
        headerName: t.riskLog.colLinks,
        width: 146,
        sortable: false,
        filter: false,
        getQuickFilterText: () => '',
        cellRenderer: (p: ICellRendererParams<RiskRow>) => (p.data ? <Links row={p.data} t={t} /> : null),
      },
    ],
    [t, lang, layout],
  );

  const shown = useMemo(() => {
    const q = quick.trim().toLowerCase();
    return rows.filter((r) => passesFilters(r, filters) && (!q || [r.store, r.product, r.ref ?? '', r.verdict ? t.verdict[r.verdict] : '', outcomeLabel(r.outcome)].join(' ').toLowerCase().includes(q)));
  }, [rows, filters, quick, t]);

  if (!rows.length) return <p className="mt-6 text-[15px] text-muted">{t.riskLog.empty}</p>;

  const set = (patch: Partial<RiskFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = filters.verdict || filters.outcome || filters.from || filters.to || quick;

  return (
    <div className="mt-6 space-y-6">
      <Summary t={t} summary={summary} stopped={stopped} money={money} />
      <VerdictChart rows={rows} t={t} lang={lang} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className={labelClass} htmlFor="risk-search">
            {t.riskLog.search}
          </label>
          <input id="risk-search" type="search" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={t.riskLog.searchPlaceholder} className={input} />
        </div>
        <Select id="risk-verdict" label={t.riskLog.verdictFilter} value={filters.verdict ?? ''} onChange={(v) => set({ verdict: (v || null) as Verdict | null })} options={[['', t.riskLog.any], ...(['SAFE', 'HOLD', 'BLOCK'] as const).map((v) => [v, t.verdict[v]] as [string, string])]} />
        <Select id="risk-outcome" label={t.riskLog.outcomeFilter} value={filters.outcome ?? ''} onChange={(v) => set({ outcome: (v || null) as Outcome | null })} options={[['', t.riskLog.any], ...OUTCOMES.map((o) => [o, outcomeLabel(o)] as [string, string])]} />
        <DateInput id="risk-from" label={t.riskLog.from} value={filters.from} onChange={(from) => set({ from })} />
        <DateInput id="risk-to" label={t.riskLog.to} value={filters.to} onChange={(to) => set({ to })} />
        {filtered ? (
          <button
            type="button"
            className="pb-3 text-[13px] text-muted underline underline-offset-4 hover:text-ink"
            onClick={() => {
              setFilters({ verdict: null, outcome: null, from: null, to: null });
              setQuick('');
              grid.current?.api?.setFilterModel(null);
            }}
          >
            {t.riskLog.clear}
          </button>
        ) : null}
      </div>

      {layout === 'list' ? (
        <NarrowList rows={shown} t={t} lang={lang} money={money} outcomeLabel={outcomeLabel} />
      ) : (
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<RiskRow>
            ref={grid}
            theme={gridTheme}
            localeText={lang === 'fr' ? AG_GRID_LOCALE_FR : undefined}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: false }}
            getRowId={(p) => p.data.id}
            quickFilterText={quick}
            isExternalFilterPresent={() => {
              const f = filtersRef.current;
              return !!(f.verdict || f.outcome || f.from || f.to);
            }}
            doesExternalFilterPass={(node: IRowNode<RiskRow>) => !!node.data && passesFilters(node.data, filtersRef.current)}
            pagination
            paginationPageSize={20}
            paginationPageSizeSelector={false}
            domLayout="autoHeight"
            overlayNoRowsTemplate={`<span style="color:#6B6866">${escapeHtml(t.riskLog.noMatch)}</span>`}
          />
        </AgGridProvider>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${input} pr-8`}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateInput({ id, label, value, onChange }: { id: string; label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={input} />
    </div>
  );
}

function NarrowList({ rows, t, lang, money, outcomeLabel }: { rows: RiskRow[]; t: Dict; lang: Lang; money: (a: number | null, c: string) => string; outcomeLabel: (o: Outcome) => string }) {
  if (!rows.length) return <p className="text-[15px] text-muted">{t.riskLog.noMatch}</p>;
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-white">
      {rows.slice(0, 50).map((r) => (
        <li key={r.id} className="space-y-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium">{r.store}</p>
              <p className="truncate text-[13px] text-muted">{[r.product, r.ref].filter(Boolean).join(' · ')}</p>
            </div>
            <VerdictPill verdict={r.verdict} t={t} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
            <span>
              {formatWhen(r.at, lang, 'medium')} · {money(r.amount, r.currency)} · {outcomeLabel(r.outcome)}
            </span>
            <Signals signals={r.signals} t={t} />
          </div>
          <Links row={r} t={t} />
        </li>
      ))}
    </ul>
  );
}
