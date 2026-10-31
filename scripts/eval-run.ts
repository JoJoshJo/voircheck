/**
 * Real-world eval (spec 5.5 "Eval method"): scan the source-labelled stores in eval/stores.json with the production
 * scanner and report accuracy.
 *   pnpm eval:run [--split test|tune|all] [--limit N]
 * Scan only: no payments, forms or sign-ups. Store pages are opened only inside KERNEL; the runner itself makes a
 * plain HTTP reachability check first (no browser, no JavaScript). Concurrency 2 with polite delays.
 * Writes eval/results/<date>-<split>.json + .md. No secrets or KERNEL links in the output.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { kernelVisitor, scanStore } from '@voircheck/scanner';
import { computeMetrics, loadStores, type EvalRow } from './eval/metrics';
import { checkReachability } from './eval/reachability';
import { markdownReport, summaryLines, type RunInfo } from './eval/report';
import { mapPool, selectStores, toRow } from './eval/run';

const CONCURRENCY = 2;
const SCAN_DELAY_MS = 4_000;
const CHECK_DELAY_MS = 500;

function usage(): never {
  console.error('usage: pnpm eval:run [--split test|tune|all] [--limit N]');
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const split = (opt('--split') ?? 'test') as 'tune' | 'test' | 'all';
if (!['tune', 'test', 'all'].includes(split)) usage();
const limitRaw = opt('--limit');
const limit = limitRaw === undefined ? undefined : Number(limitRaw);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) usage();

const kernelKey = process.env.KERNEL_API_KEY;
if (!kernelKey) {
  console.error('KERNEL_API_KEY missing in .env: without the cloud browser every scan is "couldn\'t verify". Stopping.');
  process.exit(1);
}
const safeBrowsingKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
if (!safeBrowsingKey) console.error('warning: GOOGLE_SAFE_BROWSING_API_KEY missing; the threat-list signal will be unavailable.');

const stores = selectStores(loadStores(JSON.parse(readFileSync('eval/stores.json', 'utf8'))), split, limit);
const scams = stores.filter((s) => s.label === 'scam').length;
console.log(`Split "${split}"${limit ? `, limit ${limit}` : ''}: ${stores.length} stores (${scams} scam, ${stores.length - scams} legit).`);
console.log(`Estimate: up to ${stores.length} KERNEL sessions (one per live store; dead sites are skipped) and up to ${stores.length} Safe Browsing lookups.`);
console.log(`Concurrency ${CONCURRENCY}, ${SCAN_DELAY_MS / 1000}s between scans per lane. AI page analysis is OFF.`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Start? [y/N] ')).trim().toLowerCase();
rl.close();
if (answer !== 'y' && answer !== 'yes') {
  console.log('Cancelled. Nothing scanned.');
  process.exit(0);
}

const visitor = kernelVisitor({ apiKey: kernelKey });
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
    const report = await scanStore({ url: store.url }, { visitor, safeBrowsingKey });
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
const info: RunInfo = { runAt: new Date().toISOString(), split, commit, aiAnalysis: 'off' };
const metrics = computeMetrics(rows);

mkdirSync('eval/results', { recursive: true });
let stem = `eval/results/${info.runAt.slice(0, 10)}-${split}`;
for (let n = 2; existsSync(`${stem}.json`); n++) stem = `eval/results/${info.runAt.slice(0, 10)}-${split}-${n}`;
writeFileSync(`${stem}.json`, JSON.stringify({ ...info, limit: limit ?? null, rows }, null, 2) + '\n');
writeFileSync(`${stem}.md`, markdownReport(metrics, rows, info));

console.log('');
for (const line of summaryLines(metrics, info)) console.log(line);
console.log(`\nSaved ${stem}.json and ${stem}.md`);
