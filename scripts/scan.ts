/**
 * Run one real store scan and print the result JSON.
 *   pnpm scan <url> [--peers url1,url2]
 * Needs KERNEL_API_KEY and GOOGLE_SAFE_BROWSING_API_KEY in .env; ANTHROPIC_API_KEY turns on AI page analysis
 * (SCAN_MODEL, default claude-sonnet-5-5; results cached 24h per URL in .cache/ai-page). Prints no secrets: live-view/replay links
 * have their query strings (session tokens) removed.
 */
import 'dotenv/config';
import { anthropicAnalyzer, anthropicResearcher, kernelVisitor, scanStore } from '@voircheck/scanner';
import { fileAiCache } from './ai-cache';

function usage(): never {
  console.error('usage: pnpm scan <url> [--peers url1,url2]');
  process.exit(2);
}

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--peers');
if (!url) usage();
const peersArg = args.includes('--peers') ? args[args.indexOf('--peers') + 1] : undefined;
const peers = (peersArg ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((u) => ({ url: u }));

const kernelKey = process.env.KERNEL_API_KEY;
if (!kernelKey) console.error('warning: KERNEL_API_KEY missing; the scan will be "couldn\'t verify"');

const stripQuery = (u?: string) => (u ? u.split('?')[0] + (u.includes('?') ? '?<token removed>' : '') : undefined);

const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) console.error('warning: ANTHROPIC_API_KEY missing; AI page analysis will be "unavailable"');

const { result, meta } = await scanStore(
  { url, peers },
  {
    visitor: kernelKey ? kernelVisitor({ apiKey: kernelKey, proxyId: process.env.KERNEL_PROXY_ID || undefined }) : null,
    safeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY,
    ...(anthropicKey ? { analyzer: anthropicAnalyzer({ apiKey: anthropicKey, model: process.env.SCAN_MODEL, cache: fileAiCache(), log: (l) => console.error(l) }) } : {}),
    researcher: anthropicKey && !args.includes('--no-research') ? anthropicResearcher({ apiKey: anthropicKey, model: process.env.SCAN_MODEL, log: (l) => console.error(l) }) : null,
  },
);

console.log(
  JSON.stringify(
    { ...result, kernel: { ...result.kernel, liveViewUrl: stripQuery(result.kernel.liveViewUrl), replayUrl: stripQuery(result.kernel.replayUrl) } },
    null,
    2,
  ),
);
console.error(`kernel session: ${meta.kernelSessionSeconds?.toFixed(1) ?? '-'}s${meta.kernelError ? `, error: ${meta.kernelError}` : ''}`);
const rc = meta.research.reduce((n, u) => n + u.costUsd, 0);
console.error(`research: ${meta.research.reduce((n, u) => n + u.searches, 0)} searches, $${rc.toFixed(4)}, ${meta.researchMs !== null ? `${(meta.researchMs / 1000).toFixed(1)}s` : '-'}`);
