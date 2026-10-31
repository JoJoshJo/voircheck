import { SIGNAL_IDS } from '@voircheck/scanner';
import type { EvalMetrics, EvalRow, Label, ScannedRow } from './metrics';

export interface RunInfo {
  runAt: string;
  split: string;
  commit: string;
  aiAnalysis: 'off' | 'on';
}

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
    '',
    `> Small sample (${m.scored.scam} scam + ${m.scored.legit} legit scored): treat percentages as rough. AI page analysis was **${info.aiAnalysis}**, so its signal scored 0 points everywhere. Stores were scanned by URL only (homepage, no peers), so the price signal has nothing to compare against and is "unavailable". Ground truth comes from the sources in \`eval/stores.json\`, not from VoirCheck.`,
    '',
    '## Confusion table',
    '',
    '| True label | BLOCK | HOLD | SAFE |',
    '|---|---|---|---|',
    `| ${label('scam')} | ${m.scam.BLOCK} | ${m.scam.HOLD} | ${m.scam.SAFE} (missed) |`,
    `| ${label('legit')} | ${m.legit.BLOCK} (hard false alarm) | ${m.legit.HOLD} (soft false alarm) | ${m.legit.SAFE} |`,
    '',
    '## Per-signal hit rates',
    '',
    ...signalTable(m),
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
