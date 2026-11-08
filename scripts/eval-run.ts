/**
 * Real-world eval (spec 5.5 "Eval method"): scan the source-labelled stores in eval/stores.json with the production
 * scanner and report accuracy.
 *   pnpm eval:run [--split holdout|tune|seen-2026-10-31|live-2026-11|all] [--label scam|legit] [--added YYYY-MM-DD] [--limit N] [--no-research]   (default: holdout)
 * Scan only: no payments, forms or sign-ups. Store pages are opened only inside KERNEL; the runner itself makes a
 * plain HTTP reachability check first (no browser, no JavaScript). Concurrency 2 with polite delays.
 * Writes eval/results/<date>-<split>.json + .md. No secrets or KERNEL links in the output.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { anthropicAnalyzer, anthropicResearcher, costUsd, DEFAULT_SCAN_MODEL, kernelVisitor, scanStore } from '@voircheck/scanner';
import { fileAiCache } from './ai-cache';
import { computeMetrics, loadStores, SPLITS, type EvalRow, type Split } from './eval/metrics';
import { checkReachability } from './eval/reachability';
import { aiLines, markdownReport, summaryLines, type RunInfo } from './eval/report';
import { mapPool, selectStores, toRow } from './eval/run';

const CONCURRENCY = 2;
const SCAN_DELAY_MS = 4_000;
/** Upper bound per AI call at the input caps: ~11.5k input tokens (incl. system prompt) + 1.2k output. */
const AI_MAX_CALL = { inputTokens: 11_500, outputTokens: 1_200, cacheReadTokens: 0, cacheWriteTokens: 0 };
const CHECK_DELAY_MS = 500;

function usage(): never {
  console.error(`usage: pnpm eval:run [--split ${SPLITS.join('|')}|all] [--label scam|legit] [--added YYYY-MM-DD] [--limit N] [--no-research]`);
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const split = (opt('--split') ?? 'holdout') as Split | 'all';
if (![...SPLITS, 'all'].includes(split)) usage();
const limitRaw = opt('--limit');
const limit = limitRaw === undefined ? undefined : Number(limitRaw);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) usage();
const label = opt('--label');
/** Only stores added on this day (a new batch), e.g. --added 2026-11-08. */
const added = opt('--added');
if (added !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(added)) usage();
if (label !== undefined && label !== 'scam' && label !== 'legit') usage();

const kernelKey = process.env.KERNEL_API_KEY;
if (!kernelKey) {
  console.error('KERNEL_API_KEY missing in .env: without the cloud browser every scan is "couldn\'t verify". Stopping.');
  process.exit(1);
}
const safeBrowsingKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
if (!safeBrowsingKey) console.error('warning: GOOGLE_SAFE_BROWSING_API_KEY missing; the threat-list signal will be unavailable.');

const stores = selectStores(loadStores(JSON.parse(readFileSync('eval/stores.json', 'utf8'))).filter((s) => (!label || s.label === label) && (!added || s.addedOn === added)), split, limit);
const scams = stores.filter((s) => s.label === 'scam').length;
if (stores.length === 0) {
  console.log(`Split "${split}" has no stores yet. Nothing scanned.`);
  process.exit(0);
}
console.log(`Split "${split}"${label ? `, ${label} only` : ''}${added ? `, added ${added}` : ''}${limit ? `, limit ${limit}` : ''}: ${stores.length} stores (${scams} scam, ${stores.length - scams} legit).`);
console.log(`Estimate: up to ${stores.length} KERNEL sessions (one per live store; dead sites are skipped) and up to ${stores.length} Safe Browsing lookups.`);
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const aiModel = process.env.SCAN_MODEL || DEFAULT_SCAN_MODEL;
const aiMaxPerScan = costUsd(AI_MAX_CALL, aiModel);
console.log(
  anthropicKey
    ? `AI page analysis is ON (${aiModel}): up to ${stores.length} model calls, at most ~$${(stores.length * aiMaxPerScan).toFixed(3)} (≤ $${aiMaxPerScan.toFixed(4)} per scan; URLs analyzed in the last 24h cost $0).`
    : 'AI page analysis is OFF (no ANTHROPIC_API_KEY).',
);
const research = !!anthropicKey && !args.includes('--no-research');
/** Upper bound per scan: 3 reputation + 2 price searches ($0.05) plus their result tokens. */
const RESEARCH_MAX_PER_SCAN = 0.15;
console.log(
  research
    ? `Research step (web search) is ON: up to ${stores.length} reputation lookups (≤ 3 searches each; price searches only for pages with a product), at most ~$${(stores.length * RESEARCH_MAX_PER_SCAN).toFixed(2)}.`
    : 'Research step (web search) is OFF.',
);
console.log(`Concurrency ${CONCURRENCY}, ${SCAN_DELAY_MS / 1000}s between scans per lane.`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Start? [y/N] ')).trim().toLowerCase();
rl.close();
if (answer !== 'y' && answer !== 'yes') {
  console.log('Cancelled. Nothing scanned.');
  process.exit(0);
}

const visitor = kernelVisitor({ apiKey: kernelKey, proxyId: process.env.KERNEL_PROXY_ID || undefined });
const analyzer = anthropicKey ? anthropicAnalyzer({ apiKey: anthropicKey, model: aiModel, cache: fileAiCache(), log: (l) => console.log(`    ${l}`) }) : undefined;
const researcher = research ? anthropicResearcher({ apiKey: anthropicKey, model: aiModel, log: (l) => console.log(`    ${l}`) }) : null;
let done = 0;
const rows: EvalRow[] = await mapPool(stores, CONCURRENCY, CHECK_DELAY_MS, async (store): Promise<EvalRow> => {
  const base = { url: store.url, label: store.label, split: store.split };
  const reach = await checkReachability(store.url);
  if (!reach.alive) {
    console.log(`[${++done}/${stores.length}] ${store.url}: dead (${reach.reason})`);
    return { ...base, outcome: 'dead', deadReason: reach.reason };
  }
  if (reach.note) console.log(`    ${store.url}: ${reach.note}`);
  await new Promise((r) => setTimeout(r, SCAN_DELAY_MS));
  const t0 = performance.now();
  try {
    const report = await scanStore({ url: store.url }, { visitor, safeBrowsingKey, researcher, ...(analyzer ? { analyzer } : {}) });
    const row = toRow(store, report, performance.now() - t0);
    console.log(`[${++done}/${stores.length}] ${store.url}: ${report.result.verdict} (${report.result.score})`);
    return row;
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.log(`[${++done}/${stores.length}] ${store.url}: error (${error})`);
    return { ...base, outcome: 'error', error };
  }
});

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // not a git checkout
}
const info: RunInfo = { runAt: new Date().toISOString(), split, commit, aiAnalysis: anthropicKey ? 'on' : 'off', ...(anthropicKey ? { aiModel } : {}) };
const metrics = computeMetrics(rows);

mkdirSync('eval/results', { recursive: true });
let stem = `eval/results/${info.runAt.slice(0, 10)}-${split}${label ? `-${label}` : ''}${added ? `-added-${added}` : ''}`;
for (let n = 2, base = stem; existsSync(`${stem}.json`); n++) stem = `${base}-${n}`;
writeFileSync(`${stem}.json`, JSON.stringify({ ...info, limit: limit ?? null, rows }, null, 2) + '\n');
writeFileSync(`${stem}.md`, markdownReport(metrics, rows, info));

console.log('');
for (const line of [...summaryLines(metrics, info), ...aiLines(rows, info)]) console.log(line);
const researched = rows.flatMap((r) => (r.outcome === 'scanned' && r.research ? [r.research] : []));
if (researched.length) {
  const times = researched.map((r) => r.ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const cost = researched.reduce((n, r) => n + r.costUsd, 0);
  console.log(`Research: $${cost.toFixed(4)} total = $${(cost / researched.length).toFixed(4)} per scan, ${researched.reduce((n, r) => n + r.searches, 0)} searches, median ${times.length ? (times[Math.floor(times.length / 2)]! / 1000).toFixed(1) : '-'} s (runs alongside the page visit).`);
}
console.log(`\nSaved ${stem}.json and ${stem}.md`);
