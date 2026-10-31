/**
 * Run one real store scan and print the result JSON.
 *   pnpm scan <url> [--peers url1,url2]
 * Needs KERNEL_API_KEY and GOOGLE_SAFE_BROWSING_API_KEY in .env. Prints no secrets: live-view/replay links
 * have their query strings (session tokens) removed.
 */
import 'dotenv/config';
import { kernelVisitor, scanStore } from '@voircheck/scanner';

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

const { result, meta } = await scanStore(
  { url, peers },
  {
    visitor: kernelKey ? kernelVisitor({ apiKey: kernelKey, proxyId: process.env.KERNEL_PROXY_ID || undefined }) : null,
    safeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY,
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
