'use client';

import { BarSeriesModule, CategoryAxisModule, LegendModule, ModuleRegistry, NumberAxisModule, type AgCartesianChartOptions } from 'ag-charts-community';
import { AgCharts } from 'ag-charts-react';
import { useMemo } from 'react';
import type { Dict, Lang } from '../lib/i18n';
import { localDay, summarize, verdictsPerDay, type RiskRow, type Verdict } from '../lib/risk-log-map';

/**
 * History totals + verdicts per day (AG Charts Community 14.2.0, MIT). Only the chart modules this uses are
 * registered. Loaded with the risk log (RiskLogLazy), so only the History page pays for it.
 */
ModuleRegistry.registerModules([BarSeriesModule, CategoryAxisModule, NumberAxisModule, LegendModule]);

// Mid tones of the verdict colors (the pill text shades are too dark to tell HOLD from BLOCK in a stack).
const VERDICT_FILL: Record<Verdict, string> = { SAFE: '#639922', HOLD: '#EF9F27', BLOCK: '#E24B4A' };

export function Summary({ t, summary, money }: { t: Dict; summary: ReturnType<typeof summarize>; money: (a: number | null, c: string) => string }) {
  const total = (byCurrency: Record<string, number>) => Object.entries(byCurrency).map(([c, a]) => money(a, c)).join(' + ') || money(0, 'USD');
  const protectedText = total(summary.protectedByCurrency);
  const tile = 'rounded-card border border-line bg-white p-4';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className={tile}>
        <p className="text-[13px] text-muted">{t.riskLog.storesChecked}</p>
        <p className="mt-1 text-[26px] font-medium tracking-tight">{summary.storesChecked}</p>
      </div>
      <div className={tile}>
        <p className="text-[13px] text-muted">{t.riskLog.scamsBlocked}</p>
        <p className="mt-1 text-[26px] font-medium tracking-tight">{summary.scamsBlocked}</p>
      </div>
      <div className={tile}>
        <p className="text-[13px] text-muted">{t.riskLog.moneyProtected}</p>
        <p className="mt-1 text-[26px] font-medium tracking-tight">{protectedText}</p>
        <p className="mt-1 text-[12px] text-faint">{t.riskLog.moneyProtectedNote}</p>
      </div>
      <div className={tile}>
        <p className="text-[13px] text-muted">{t.riskLog.refunded}</p>
        <p className="mt-1 text-[26px] font-medium tracking-tight">{total(summary.refundedByCurrency)}</p>
        <p className="mt-1 text-[12px] text-faint">{t.riskLog.refundedNote}</p>
      </div>
    </div>
  );
}

export function VerdictChart({ rows, t, lang }: { rows: RiskRow[]; t: Dict; lang: Lang }) {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const data = useMemo(() => verdictsPerDay(rows, (iso) => localDay(iso)), [rows]);
  // The chart draws on a canvas, which can't 'inherit' a font: hand it the page's own (client-only component).
  const fontFamily = useMemo(() => getComputedStyle(document.body).fontFamily, []);
  const options = useMemo<AgCartesianChartOptions>(
    () => ({
      data,
      height: 220,
      padding: { top: 8, right: 8, bottom: 4, left: 4 },
      background: { fill: '#FFFFFF' },
      series: (['SAFE', 'HOLD', 'BLOCK'] as const).map((v) => ({
        type: 'bar' as const,
        xKey: 'day',
        yKey: v,
        yName: t.verdict[v],
        stacked: true,
        fill: VERDICT_FILL[v],
        stroke: VERDICT_FILL[v],
        cornerRadius: 3,
      })),
      axes: {
        x: {
          type: 'category',
          position: 'bottom',
          line: { stroke: '#E7E5E4' },
          label: { color: '#6B6866', fontSize: 13, formatter: ({ value }: { value: unknown }) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${String(value)}T00:00:00Z`)) },
        },
        y: {
          type: 'number',
          position: 'left',
          title: { enabled: false },
          gridLine: { style: [{ stroke: '#E7E5E4', lineDash: [] }] },
          label: { color: '#6B6866', fontSize: 13, formatter: ({ value }: { value: unknown }) => (Number.isInteger(value) ? String(value) : '') },
        },
      },
      legend: { position: 'bottom', item: { label: { color: '#0C0C0C', fontSize: 13 } } },
      theme: { params: { fontFamily, fontSize: 13, foregroundColor: '#0C0C0C', backgroundColor: '#FFFFFF' } },
    }),
    [data, t, locale, fontFamily],
  );
  return (
    <section className="rounded-card border border-line bg-white p-4" aria-label={t.riskLog.chartTitle}>
      <h3 className="text-[15px] font-medium">{t.riskLog.chartTitle}</h3>
      {data.length ? <AgCharts options={options} /> : <p className="mt-2 text-[14px] text-muted">{t.riskLog.chartEmpty}</p>}
    </section>
  );
}

