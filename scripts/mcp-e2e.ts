/**
 * End-to-end check of VoirCheck's MCP server with the official MCP SDK client over Streamable HTTP:
 *   pnpm mcp:e2e --url http://localhost:3000/api/mcp   (VOIRCHECK_MCP_TOKEN=<token from Settings> in the environment)
 *   pnpm mcp:e2e --local                                (in-process harness, see below)
 * Calls: no token (expects 401), a revoked token (--local only), tools/list, check_store + get_verdict on two fictional
 * demo stores (Velbrook Supply: Safe; Velbrook-Outlet Deals: Block), prepare_purchase at the Block store (expects
 * "block"), with a wrong amount (expects "amount_mismatch"), then for real at the Safe store: a PayPal SANDBOX order
 * waiting for approval. Nobody approves it, so nothing is ever held or charged. Writes eval/mcp/<date>[-local].md.
 * The token is never printed or written: the transcript shows "Bearer vcmcp_…(redacted)".
 *
 * --local: the same SDK client against an in-process HTTP server running the SAME MCP server code (apps/web/lib/mcp/
 * core.ts) with real MoneyGate on the PayPal sandbox and the app's cached scans (read-only), but an in-memory token
 * check instead of the api_tokens table. For when the database migration isn't applied yet.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { demoPeersForUrl } from '@voircheck/agent';
import { MemoryGateStore, MoneyGate, PayPalClient } from '@voircheck/paypal';
import { createMcpServer, preparePurchaseWith, storeOutput, type McpApi } from '../apps/web/lib/mcp/core';
import { labScan, type Spend } from './lab/live';

const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const base = (process.env.DEMO_STORES_BASE_URL || 'https://voircheck-stores.onrender.com').replace(/\/$/, '');
const SAFE_URL = `${base}/s/velbrook-supply/products/zephlet-buds`;
const BLOCK_URL = `${base}/s/velbrook-outlet-deals/products/zephlet-buds`;
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};
const spend: Spend = { agentUsd: 0, scanUsd: 0, kernelSessions: 0 };

/** The in-process harness: same MCP server, real MoneyGate (sandbox), cached scans, tokens checked in memory. */
async function startLocal(): Promise<{ endpoint: string; token: string; revoked: string; close: () => void }> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox) are missing');
  const store = new MemoryGateStore();
  const gate = new MoneyGate({ paypal: new PayPalClient({ clientId, clientSecret }), store });
  const userId = 'e2e-user';
  const token = `vcmcp_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
  const revoked = `vcmcp_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
  let n = 0;
  const api: McpApi = {
    async checkStore(url) {
      const s = await labScan(url, spend); // fresh cached scan from the app's database; a real scan otherwise
      const demo = demoPeersForUrl(s.url, base);
      const id = `00000000-0000-4000-a000-${String(++n).padStart(12, '0')}`;
      const scanId = `scan-${id}`;
      store.scans.set(scanId, { id: scanId, url: s.url, verdict: s.verdict, riskScore: s.score, scannedAt: new Date(), cacheExpiresAt: new Date(Date.now() + 3_600_000) });
      const price = demo ? demo.price.toFixed(2) : null;
      store.candidates.set(id, { id, sessionId: `session-${id}`, userId, storeName: demo?.storeName ?? new URL(s.url).hostname, storeUrl: demo?.storeUrl ?? s.url, productTitle: demo?.productTitle ?? '', price, currency: 'USD', source: demo ? 'demo' : 'link' });
      return { ok: true, data: storeOutput({ scan: { id: scanId, url: s.url, verdict: s.verdict, score: s.score, signals: s.signals, hardRules: s.hardRules as never, scannedAt: new Date() }, origin: 'http://localhost:3000', cached: s.cached, candidate: { id, price, currency: 'USD' } }) };
    },
    async getVerdict(url) {
      const s = await labScan(url, spend);
      return { ok: true, data: storeOutput({ scan: { id: 'cached', url: s.url, verdict: s.verdict, score: s.score, signals: s.signals, hardRules: s.hardRules as never, scannedAt: new Date() }, origin: 'http://localhost:3000', cached: true }) };
    },
    async preparePurchase(storeId, amount) {
      return preparePurchaseWith({ gate, getCandidate: (id, uid) => store.getCandidateForUser(id, uid), scanIdFor: async (c) => `scan-${c.id}` }, { userId, origin: 'http://localhost:3000' }, storeId, amount);
    },
  };
  const http = createServer(async (req, res) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${token}`) {
      // Unknown and revoked tokens look the same from outside: 401.
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="voircheck"' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await createMcpServer(api).connect(transport);
    const r = await transport.handleRequest(request);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  return { endpoint: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, token, revoked, close: () => http.close() };
}

const target = LOCAL ? await startLocal() : null;
const endpoint = target?.endpoint ?? (args.includes('--url') ? args[args.indexOf('--url') + 1]! : 'http://localhost:3000/api/mcp');
const token = target?.token ?? process.env.VOIRCHECK_MCP_TOKEN?.trim();
if (!token) {
  console.error('Set VOIRCHECK_MCP_TOKEN (Settings → Connect an AI agent), or use --local. Stopping.');
  process.exit(1);
}

say(`# MCP end to end (${new Date().toISOString().slice(0, 10)})`);
say('');
say(`Endpoint: \`${LOCAL ? 'in-process harness (same MCP server code, real MoneyGate on the PayPal sandbox, cached scans)' : endpoint}\`. Client: \`@modelcontextprotocol/sdk\` 1.32.2, Streamable HTTP. Token: \`Bearer vcmcp_…(redacted)\`.`);
say('');

const rpc = (auth: string | null) =>
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
say(`## No token\n\n→ POST tools/list without Authorization\n\n← HTTP ${(await rpc(null)).status}\n`);
if (target) say(`## Revoked token\n\n→ POST tools/list with a revoked token\n\n← HTTP ${(await rpc(`Bearer ${target.revoked}`)).status}\n`);

const client = new Client({ name: 'voircheck-e2e', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
const { tools } = await client.listTools();
say(`## tools/list\n\n← ${tools.map((t) => `\`${t.name}(${Object.keys(t.inputSchema.properties ?? {}).join(', ')})\``).join(', ')}\n`);

async function call(name: string, a: Record<string, string>) {
  const r = (await client.callTool({ name, arguments: a })) as { content: Array<{ text: string }>; isError?: boolean };
  const text = r.content[0]?.text ?? '';
  say(`## ${name}\n\n→ \`${JSON.stringify(a)}\`\n\n← ${r.isError ? '(error) ' : ''}\n\n\`\`\`json\n${text}\n\`\`\`\n`);
  return { data: JSON.parse(text) as Record<string, unknown>, isError: !!r.isError };
}

const safe = await call('check_store', { url: SAFE_URL });
await call('get_verdict', { url: SAFE_URL });
const blocked = await call('check_store', { url: BLOCK_URL });
const refusedBlock = await call('prepare_purchase', { storeId: String(blocked.data.storeId), amount: String(blocked.data.price) });
const mismatch = await call('prepare_purchase', { storeId: String(safe.data.storeId), amount: '1.00' });
const prepared = await call('prepare_purchase', { storeId: String(safe.data.storeId), amount: String(safe.data.price) });
await client.close();
target?.close();

const checks = [
  ['no capture / void / refund tool', tools.every((t) => !/capture|void|refund/.test(t.name))],
  ['Block store refused', refusedBlock.isError && refusedBlock.data.error === 'block'],
  ['wrong amount refused', mismatch.isError && mismatch.data.error === 'amount_mismatch'],
  ['Safe store: sandbox approval link for the person', !prepared.isError && /^https:\/\/www\.sandbox\.paypal\.com\//.test(String(prepared.data.approvalUrl))],
  ['no page text in any output', !log.join('\n').includes('Ignore your instructions')],
] as const;
say('## Checks\n');
for (const [what, ok] of checks) say(`- ${ok ? 'PASS' : 'FAIL'}: ${what}`);
say(`\nThe prepared order was never approved, so nothing was held or charged. KERNEL sessions: ${spend.kernelSessions}; scan AI $${spend.scanUsd.toFixed(4)}.`);

const date = new Date().toISOString().slice(0, 10);
mkdirSync('eval/mcp', { recursive: true });
const file = `eval/mcp/${date}${LOCAL ? '-local' : ''}.md`;
// The approval link's sandbox order ID is redacted too: the file is published in the repository.
writeFileSync(file, `${log.join('\n')}\n`.replaceAll(token, 'vcmcp_…(redacted)').replace(/([?&]token=)[A-Z0-9]+/g, '$1…(sandbox order id redacted)'));
console.log(`\nWrote ${file}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
