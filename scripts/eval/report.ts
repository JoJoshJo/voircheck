import { SIGNAL_IDS } from '@voircheck/scanner';
import { computeMetrics, type EvalMetrics, type EvalRow, type Label, type ScannedRow } from './metrics';

export interface RunInfo {
  runAt: string;
  split: string;
  commit: string;
  aiAnalysis: 'off' | 'on';
  /** Model used for AI page analysis when on. */
  aiModel?: string;
}

/** The same rows scored without the AI signal (each row's `withoutAi`). */
export function withoutAiRows(rows: EvalRow[]): EvalRow[] {
  return rows.map((r) => (r.outcome === 'scanned' && r.withoutAi ? { ...r, verdict: r.withoutAi.verdict, score: r.withoutAi.score } : r));
}

export interface AiCost {
  scans: number;
  calls: number;
  cachedHits: number;
  totalUsd: number;
  perCallUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export function aiCost(rows: EvalRow[]): AiCost {
  const ai = rows.flatMap((r) => (r.outcome === 'scanned' && r.ai ? [r.ai] : []));
  const calls = ai.filter((a) => !a.cached);
  const sum = (f: (a: (typeof ai)[number]) => number) => ai.reduce((n, a) => n + f(a), 0);
  const totalUsd = Math.round(sum((a) => a.costUsd) * 1e6) / 1e6;
  return {
    scans: rows.filter((r) => r.outcome === 'scanned').length,
    calls: calls.length,
    cachedHits: ai.length - calls.length,
    totalUsd,
    perCallUsd: calls.length ? totalUsd / calls.length : null,
    inputTokens: sum((a) => a.inputTokens),
    outputTokens: sum((a) => a.outputTokens),
    cacheReadTokens: sum((a) => a.cacheReadTokens),
  };
}

const usd = (x: number | null) => (x === null ? 'n/a' : `$${x.toFixed(4)}`);

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
const frac = (n: number, d: number) => `${n}/${d}`;
const secs = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Short printed summary (also the top of the Markdown report). */
export function summaryLines(m: EvalMetrics, info: RunInfo): string[] {
  const s = m.scored;
  return [
    `VoirCheck real-world eval — split "${info.split}", ${info.runAt.slice(0, 10)}, commit ${info.commit}. AI page analysis: ${info.aiAnalysis.toUpperCase()}.`,
    `Sample: ${m.total} stores; ${m.dead} dead (excluded: ${m.deadByLabel.scam} scam, ${m.deadByLabel.legit} legit), ${m.errors} runner errors (excluded); scored ${s.scam} scam + ${s.legit} legit.`,
    `Scams caught (HOLD or BLOCK): ${frac(m.scam.HOLD + m.scam.BLOCK, s.scam)} = ${pct(m.catchRate)} (BLOCK ${m.scam.BLOCK}, HOLD ${m.scam.HOLD}, missed ${m.scam.SAFE}); ${m.scamCaughtByCantVerifyOnly} of those only via "couldn't verify".`,
    `Legit false alarms: hard (BLOCK) ${frac(m.legit.BLOCK, s.legit)} = ${pct(m.hardFalseAlarmRate)}, soft (HOLD) ${frac(m.legit.HOLD, s.legit)} = ${pct(m.softFalseAlarmRate)}.`,
    `Median scan time: ${secs(m.medianScanMs)}.`,
  ];
}

/** Before vs after AI, and what the AI cost. Only when AI page analysis was on. */
export function aiLines(rows: EvalRow[], info: RunInfo): string[] {
  if (info.aiAnalysis !== 'on') return [];
  const before = computeMetrics(withoutAiRows(rows));
  const after = computeMetrics(rows);
  const c = aiCost(rows);
  const caught = (m: EvalMetrics) => `${frac(m.scam.HOLD + m.scam.BLOCK, m.scored.scam)} (BLOCK ${m.scam.BLOCK}, HOLD ${m.scam.HOLD})`;
  const alarms = (m: EvalMetrics) => `BLOCK ${m.legit.BLOCK}, HOLD ${m.legit.HOLD} of ${m.scored.legit}`;
  return [
    `Without AI: scams caught ${caught(before)}; legit false alarms ${alarms(before)}.`,
    `With AI (${info.aiModel ?? 'model'}): scams caught ${caught(after)}; legit false alarms ${alarms(after)}.`,
    `AI cost: ${usd(c.totalUsd)} total for ${c.calls} model call${c.calls === 1 ? '' : 's'} (${c.cachedHits} cached) = ${usd(c.perCallUsd)} per scan; ${c.inputTokens} input tokens (${c.cacheReadTokens} more read from cache), ${c.outputTokens} output.`,
  ];
}

function aiTable(rows: EvalRow[]): string[] {
  const out = ['| URL | Label | Without AI | With AI | AI status | AI findings | AI cost |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    if (r.outcome !== 'scanned') continue;
    const ai = r.signals.find((s) => s.id === 'ai_page');
    const kinds = (ai?.evidence ?? []).slice(1).map((e) => e.split(' (')[0]);
    out.push(
      `| ${r.url} | ${r.label} | ${r.withoutAi ? `${r.withoutAi.verdict} ${r.withoutAi.score}` : '-'} | ${r.verdict} ${r.score} | ${ai?.status ?? '-'} (${ai?.points ?? 0}) | ${cell(kinds.join(', ')) || '-'} | ${r.ai ? (r.ai.cached ? 'cached' : usd(r.ai.costUsd)) : '-'} |`,
    );
  }
  return out;
}

function signalTable(m: EvalMetrics): string[] {
  const out = ['| Signal | Scam: hit rate (fail+warn / available) | Scam coverage | Legit: hit rate | Legit coverage |', '|---|---|---|---|---|'];
  for (const id of SIGNAL_IDS) {
    const a = m.perSignal.scam[id];
    const b = m.perSignal.legit[id];
    out.push(`| ${id} | ${pct(a?.hitRate ?? null)} | ${pct(a?.coverage ?? null)} | ${pct(b?.hitRate ?? null)} | ${pct(b?.coverage ?? null)} |`);
  }
  return out;
}

function rowDetail(r: ScannedRow): string[] {
  const out = [`#### ${r.url} — ${r.label}, ${r.verdict} (score ${r.score})${r.hardRules.length ? `, hard rules: ${r.hardRules.join(', ')}` : ''}`, ''];
  for (const s of r.signals) out.push(`- **${s.id}**: ${s.status} (${s.points} pts)${s.evidence.length ? ` — ${cell(s.evidence.join(' · ')).slice(0, 400)}` : ''}`);
  if (r.kernelError) out.push(`- cloud browser error: ${cell(r.kernelError)}`);
  out.push('');
  return out;
}

export function markdownReport(m: EvalMetrics, rows: EvalRow[], info: RunInfo): string {
  const label = (l: Label) => (l === 'scam' ? 'Scam (source-listed)' : 'Legit (source-listed)');
  return [
    `# VoirCheck real-world eval: ${info.split} split, ${info.runAt.slice(0, 10)}`,
    '',
    ...summaryLines(m, info).map((l) => `- ${l}`),
    ...aiLines(rows, info).map((l) => `- ${l}`),
    '',
    `> Small sample (${m.scored.scam} scam + ${m.scored.legit} legit scored): treat percentages as rough. ${info.aiAnalysis === 'on' ? `AI page analysis was **on** (${info.aiModel ?? 'model'}); "without AI" re-scores the same scans with its points and hard rule removed.` : 'AI page analysis was **off**, so its signal scored 0 points everywhere.'} Stores were scanned by URL only (homepage, no peers), so the price signal has nothing to compare against and is "unavailable". Ground truth comes from the sources in \`eval/stores.json\`, not from VoirCheck.`,
    '',
    '## Confusion table',
    '',
    '| True label | BLOCK | HOLD | SAFE |',
    '|---|---|---|---|',
    `| ${label('scam')} | ${m.scam.BLOCK} | ${m.scam.HOLD} | ${m.scam.SAFE} (missed) |`,
    `| ${label('legit')} | ${m.legit.BLOCK} (hard false alarm) | ${m.legit.HOLD} (soft false alarm) | ${m.legit.SAFE} |`,
    '',
    ...(info.aiAnalysis === 'on' ? ['## Before vs after AI', '', ...aiTable(rows), ''] : []),
    '## Per-signal hit rates',
    '',
    ...signalTable(m),
    '',
    '## Facts collected for page analysis (evidence only, not scored)',
    '',
    `Out of the scored stores (scam N=${m.scored.scam}, legit N=${m.scored.legit}); a scan blocked by a bot check collects nothing.`,
    '',
    '| Fact | Scam | Legit |',
    '|---|---|---|',
    ...m.facts.map((f) => `| ${f.fact} | ${frac(f.scam, m.scored.scam)} | ${frac(f.legit, m.scored.legit)} |`),
    '',
    `## Missed scams (${m.misses.length})`,
    '',
    ...(m.misses.length ? m.misses.flatMap(rowDetail) : ['None.', '']),
    `## False alarms on legit stores (${m.falseAlarms.length})`,
    '',
    ...(m.falseAlarms.length ? m.falseAlarms.flatMap(rowDetail) : ['None.', '']),
    `## Excluded (${m.dead + m.errors})`,
    '',
    ...rows.flatMap((r) => (r.outcome === 'dead' ? [`- ${r.url} (${r.label}): dead — ${cell(r.deadReason)}`] : r.outcome === 'error' ? [`- ${r.url} (${r.label}): runner error — ${cell(r.error)}`] : [])),
    '',
    '## All scored stores',
    '',
    `| URL | Label | Verdict | Score | Hard rules | Scan time |`,
    '|---|---|---|---|---|---|',
    ...rows.flatMap((r) => (r.outcome === 'scanned' ? [`| ${r.url} | ${r.label} | ${r.verdict} | ${r.score} | ${r.hardRules.join(', ') || '-'} | ${secs(r.scanMs)} |`] : [])),
    '',
  ].join('\n');
}
