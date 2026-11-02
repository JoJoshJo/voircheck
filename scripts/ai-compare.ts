/**
 * Compare scan models on the AI page-analysis step only, on the TUNE split (never seen / holdout):
 *   pnpm tsx scripts/ai-compare.ts [--models claude-haiku-5-5,claude-sonnet-5-5]
 *   pnpm tsx scripts/ai-compare.ts --models claude-sonnet-5-5 --repeat 2 --only kinderschatz.com,messtool.com   (noise check)
 * 1. Capture: one KERNEL visit per live tune store, saving the exact AI input (PageForAnalysis) to .cache/ai-input/
 *    (gitignored; reused for 24h, so a re-run makes no new visits). No model call during the visit.
 * 2. Analyze: every captured input goes to each model with the same prompt (no result cache), so differences come
 *    from the model, not from the site changing between visits.
 * A re-run reuses today's earlier comparison: models that already have a usable answer for a store are not called
 * again (only failed / missing ones are). Writes eval/results/<date>-tune-ai-compare[-n].json + .md. Prints the visit
 * count, the call count and a $ upper bound, asks y/N first.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { AI_PROMPT_VERSION, anthropicAnalyzer, costUsd, kernelVisitor, memoryAiCache, scanStore, type PageForAnalysis } from '@voircheck/scanner';
import { loadStores, type EvalStore } from './eval/metrics';
import { checkReachability } from './eval/reachability';
import { mapPool, selectStores } from './eval/run';

const DAY_MS = 86_400_000;
const INPUT_DIR = '.cache/ai-input';
/** Upper bound per call at the input caps: ~11.5k input tokens (incl. system prompt) + 1.2k output. */
const MAX_CALL = { inputTokens: 11_500, outputTokens: 1_200, cacheReadTokens: 0, cacheWriteTokens: 0 };

const args = process.argv.slice(2);
if (args.includes('--split') && args[args.indexOf('--split') + 1] !== 'tune') {
  console.error('ai-compare runs on the tune split only.');
  process.exit(2);
}
const models = (args.includes('--models') ? args[args.indexOf('--models') + 1]! : 'claude-haiku-5-5,claude-sonnet-5-5').split(',').filter(Boolean);
const kernelKey = process.env.KERNEL_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!kernelKey || !anthropicKey) {
  console.error('KERNEL_API_KEY and ANTHROPIC_API_KEY are needed in .env. Stopping.');
  process.exit(1);
}

const inputFile = (url: string) => `${INPUT_DIR}/${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`;
function savedInput(url: string): PageForAnalysis | null {
  try {
    const e = JSON.parse(readFileSync(inputFile(url), 'utf8')) as { capturedAt: number; page: PageForAnalysis };
    return Date.now() - e.capturedAt < DAY_MS ? e.page : null;
  } catch {
    return null;
  }
}

async function confirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Start? [y/N] ')).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

interface Result { risk: number | null; status: string; kinds: string[]; costUsd: number; inputTokens: number; outputTokens: number }
type Row = { url: string; label: string; note?: string; results: Record<string, Result> };

const day = new Date().toISOString().slice(0, 10);
const stores = selectStores(loadStores(JSON.parse(readFileSync('eval/stores.json', 'utf8'))), 'tune');

// ---------- noise check: --repeat N [--only host1,host2] ----------
// Re-asks the models N times on the saved inputs (no site visits, no reuse) and reports each store's spread.
const repeat = args.includes('--repeat') ? Number(args[args.indexOf('--repeat') + 1]) : 0;
if (repeat) {
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1]!.split(',').filter(Boolean) : null;
  const picked = stores.filter((s) => !only || only.some((h) => new URL(s.url).hostname.endsWith(h)));
  const ready = picked.filter((s) => savedInput(s.url));
  console.log(`Noise check: ${ready.length} stores with saved inputs (${picked.length - ready.length} without, skipped), ${repeat} runs × ${models.join(', ')}. No site visits.`);
  for (const m of models) console.log(`  ${m}: ${ready.length * repeat} calls, at most ~$${(ready.length * repeat * costUsd(MAX_CALL, m)).toFixed(3)}.`);
  if (!(await confirm())) process.exit(0);
  const out: Array<{ url: string; label: string; model: string; risks: Array<number | null>; costUsd: number }> = [];
  for (const s of ready)
    for (const model of models) {
      const risks: Array<number | null> = [];
      let cost = 0;
      for (let i = 0; i < repeat; i++) {
        const r = await anthropicAnalyzer({ apiKey: anthropicKey, model, cache: memoryAiCache(), log: (l) => console.log(`  ${model} ${l}`) }).analyze(savedInput(s.url));
        const m = /risk (\d+)\/100/.exec(r.evidence[0] ?? '');
        risks.push(m ? Number(m[1]) : null);
        cost += r.usage?.costUsd ?? 0;
      }
      out.push({ url: s.url, label: s.label, model, risks, costUsd: cost });
    }
  let stem = `eval/results/${day}-tune-ai-noise`;
  for (let n = 2; existsSync(`${stem}.json`); n++) stem = `eval/results/${day}-tune-ai-noise-${n}`;
  const lines = [
    `# AI risk noise check (tune, prompt ${AI_PROMPT_VERSION}, ${day})`,
    '',
    `${repeat} fresh runs per store on the same saved input.`,
    '',
    '| URL | Label | Model | Risks | Spread | Cost |',
    '|---|---|---|---|---|---|',
    ...out.map((o) => {
      const ok = o.risks.filter((x): x is number => x !== null);
      return `| ${o.url} | ${o.label} | ${o.model} | ${o.risks.map((x) => x ?? 'n/a').join(', ')} | ${ok.length ? `${Math.min(...ok)}–${Math.max(...ok)}` : '-'} | $${o.costUsd.toFixed(4)} |`;
    }),
    '',
    `Total: $${out.reduce((n, o) => n + o.costUsd, 0).toFixed(4)}.`,
  ];
  writeFileSync(`${stem}.json`, JSON.stringify({ day, promptVersion: AI_PROMPT_VERSION, repeat, rows: out }, null, 2) + '\n');
  writeFileSync(`${stem}.md`, lines.join('\n') + '\n');
  console.log(`\n${lines.join('\n')}\n\nSaved ${stem}.json and ${stem}.md`);
  process.exit(0);
}

const earlier = new Map<string, Record<string, Result>>();
for (let n = 1; ; n++) {
  const f = `eval/results/${day}-tune-ai-compare${n === 1 ? '' : `-${n}`}.json`;
  if (!existsSync(f)) break;
  const prev = JSON.parse(readFileSync(f, 'utf8')) as { promptVersion: string; rows: Row[] };
  if (prev.promptVersion !== AI_PROMPT_VERSION) continue;
  for (const r of prev.rows) for (const [m, res] of Object.entries(r.results)) if (res.status !== 'unavailable') earlier.set(r.url, { ...earlier.get(r.url), [m]: res });
}
const reuse = (url: string, model: string) => earlier.get(url)?.[model];

const needsCall = (url: string) => models.filter((m) => !reuse(url, m));
const toVisit = stores.filter((s) => !savedInput(s.url) && needsCall(s.url).length);
console.log(`Tune split: ${stores.length} stores (${stores.filter((s) => s.label === 'scam').length} scam). Prompt ${AI_PROMPT_VERSION}. Models: ${models.join(', ')}.`);
console.log(`Capture: ${toVisit.length} KERNEL visits (dead sites skipped; the rest are saved from the last 24h or already analyzed).`);
for (const m of models) {
  const calls = stores.filter((s) => !reuse(s.url, m)).length;
  console.log(`  ${m}: up to ${calls} calls (${stores.length - calls} reused), at most ~$${(calls * costUsd(MAX_CALL, m)).toFixed(3)} (≤ $${costUsd(MAX_CALL, m).toFixed(4)} per store).`);
}
if (!(await confirm())) {
  console.log('Cancelled. Nothing visited or analyzed.');
  process.exit(0);
}

// ---------- 1. capture ----------
mkdirSync(INPUT_DIR, { recursive: true });
const visitor = kernelVisitor({ apiKey: kernelKey, proxyId: process.env.KERNEL_PROXY_ID || undefined });
const notes = new Map<string, string>();
await mapPool(toVisit, 2, 500, async (store: EvalStore) => {
  const reach = await checkReachability(store.url);
  if (!reach.alive) return void notes.set(store.url, `dead (${reach.reason})`);
  await new Promise((r) => setTimeout(r, 4_000));
  let page: PageForAnalysis | null = null;
  const recorder = { analyze: async (p: PageForAnalysis | null) => ((page = p), { id: 'ai_page' as const, status: 'unavailable' as const, evidence: ['captured for ai-compare'] }) };
  try {
    await scanStore({ url: store.url }, { visitor, analyzer: recorder });
  } catch (err) {
    return void notes.set(store.url, `error (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!page) return void notes.set(store.url, 'no page read (blocked / error page)');
  writeFileSync(inputFile(store.url), JSON.stringify({ capturedAt: Date.now(), page }));
  console.log(`captured ${store.url}`);
});

// ---------- 2. analyze ----------
const rows: Row[] = [];
for (const store of stores) {
  const page = savedInput(store.url);
  const row: Row = { url: store.url, label: store.label, results: { ...earlier.get(store.url) } };
  if (!page && needsCall(store.url).length) row.note = notes.get(store.url) ?? 'no saved input';
  if (page) {
    for (const model of needsCall(store.url)) {
      const out = await anthropicAnalyzer({ apiKey: anthropicKey, model, cache: memoryAiCache(), log: (l) => console.log(`  ${model} ${l}`) }).analyze(page);
      const risk = /risk (\d+)\/100/.exec(out.evidence[0] ?? '');
      row.results[model] = { risk: risk ? Number(risk[1]) : null, status: out.status, kinds: (out.findings ?? []).map((f) => f.kind), costUsd: out.usage?.costUsd ?? 0, inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0 };
    }
  }
  rows.push(row);
}

// ---------- report ----------
let stem = `eval/results/${day}-tune-ai-compare`;
for (let n = 2; existsSync(`${stem}.json`); n++) stem = `eval/results/${day}-tune-ai-compare-${n}`;
const sortKey = (r: (typeof rows)[number]) => r.results[models[models.length - 1]!]?.risk ?? -1;
const sorted = [...rows].sort((a, b) => sortKey(b) - sortKey(a));
const cell = (r?: Result) => (r ? `${r.risk ?? r.status}` : '-');
const lines = [
  `# AI page analysis: ${models.join(' vs ')} (tune, prompt ${AI_PROMPT_VERSION}, ${day})`,
  '',
  'Same captured input for every model. Risk 0–100; "unavailable" = the answer was rejected or the call failed.',
  '',
  `| URL | Label | ${models.join(' | ')} | Findings (${models[models.length - 1]}) |`,
  `|---|---|${models.map(() => '---').join('|')}|---|`,
  ...sorted.map((r) => `| ${r.url} | ${r.label} | ${models.map((m) => cell(r.results[m])).join(' | ')} | ${r.note ?? (r.results[models[models.length - 1]!]?.kinds.join(', ') || '-')} |`),
  '',
  ...models.map((m) => {
    const rs = rows.flatMap((r) => (r.results[m] ? [r.results[m]!] : []));
    const total = rs.reduce((n, r) => n + r.costUsd, 0);
    return `- ${m}: ${rs.length} stores analyzed (incl. reused answers), $${total.toFixed(4)} for these answers, $${(rs.length ? total / rs.length : 0).toFixed(4)} per store.`;
  }),
];
writeFileSync(`${stem}.json`, JSON.stringify({ day, promptVersion: AI_PROMPT_VERSION, models, rows }, null, 2) + '\n');
writeFileSync(`${stem}.md`, lines.join('\n') + '\n');
console.log(`\n${lines.join('\n')}\n\nSaved ${stem}.json and ${stem}.md`);
