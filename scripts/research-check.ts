/**
 * Research step only ("What the web says"), for tuning its prompt and status rules without KERNEL or page analysis:
 * the web search needs only the store's domain.
 *   pnpm research:check [--split tune|holdout|...|all] [--label scam|legit] [--limit N]   (default: tune)
 * Costs Anthropic credit only (≤ 3 searches per store, $0.01 each, plus tokens); asks y/N first. Never opens a store
 * page. Writes eval/research/<date>-<split>[-label].json with every finding's kind, note and source, so a "red flag"
 * on a real shop can be checked against the page it came from.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { anthropicResearcher, DEFAULT_SCAN_MODEL, domainInfo, RESEARCH_PROMPT_VERSION, type WebReputation } from '@voircheck/scanner';
import { loadStores, SPLITS, type Split } from './eval/metrics';
import { mapPool, selectStores } from './eval/run';

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const split = (opt('--split') ?? 'tune') as Split | 'all';
const label = opt('--label');
const limit = opt('--limit') ? Number(opt('--limit')) : undefined;
if (![...SPLITS, 'all'].includes(split) || (label && label !== 'scam' && label !== 'legit') || (limit !== undefined && !(limit > 0))) {
  console.error(`usage: pnpm research:check [--split ${SPLITS.join('|')}|all] [--label scam|legit] [--limit N]`);
  process.exit(2);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY missing in .env. Stopping.');
  process.exit(1);
}

const stores = selectStores(loadStores(JSON.parse(readFileSync('eval/stores.json', 'utf8'))).filter((s) => !label || s.label === label), split, limit);
const model = process.env.SCAN_MODEL || DEFAULT_SCAN_MODEL;
console.log(`Split "${split}"${label ? `, ${label} only` : ''}: ${stores.length} stores. Research prompt ${RESEARCH_PROMPT_VERSION}, ${model}.`);
console.log(`Estimate: up to ${stores.length * 3} web searches ($${(stores.length * 0.03).toFixed(2)}) plus tokens, at most ~$${(stores.length * 0.15).toFixed(2)}. No KERNEL, no store pages opened.`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Start? [y/N] ')).trim().toLowerCase();
rl.close();
if (answer !== 'y' && answer !== 'yes') {
  console.log('Cancelled. Nothing searched.');
  process.exit(0);
}

const researcher = anthropicResearcher({ apiKey, model, log: (l) => console.log(`    ${l}`) });
type Out = { url: string; label: string; domain: string; reputation: WebReputation; costUsd: number; searches: number; ms: number };
const rows: Out[] = await mapPool(stores, 2, 500, async (s) => {
  const d = domainInfo(s.url);
  const domain = d.registrable ?? d.hostname;
  const t0 = performance.now();
  const { reputation, usage } = await researcher.reputation(domain);
  const row = { url: s.url, label: s.label, domain, reputation, costUsd: usage?.costUsd ?? 0, searches: usage?.searches ?? 0, ms: Math.round(performance.now() - t0) };
  console.log(`${s.label.padEnd(5)} ${domain}: ${reputation.status} [${reputation.findings.map((f) => f.kind).join(', ')}]`);
  return row;
});

const by = (lab: string, st: string) => rows.filter((r) => r.label === lab && r.reputation.status === st).length;
for (const lab of ['scam', 'legit']) {
  const n = rows.filter((r) => r.label === lab).length;
  if (n) console.log(`${lab}: ${n} → fail ${by(lab, 'fail')}, warn ${by(lab, 'warn')}, pass ${by(lab, 'pass')}, not checked ${by(lab, 'unavailable')}`);
}
const cost = rows.reduce((n, r) => n + r.costUsd, 0);
console.log(`Cost $${cost.toFixed(4)} ($${(cost / Math.max(1, rows.length)).toFixed(4)} per store), ${rows.reduce((n, r) => n + r.searches, 0)} searches.`);

mkdirSync('eval/research', { recursive: true });
let stem = `eval/research/${new Date().toISOString().slice(0, 10)}-${split}${label ? `-${label}` : ''}`;
for (let n = 2, base = stem; existsSync(`${stem}.json`); n++) stem = `${base}-${n}`;
writeFileSync(`${stem}.json`, JSON.stringify({ promptVersion: RESEARCH_PROMPT_VERSION, model, rows }, null, 2) + '\n');
console.log(`Saved ${stem}.json`);
