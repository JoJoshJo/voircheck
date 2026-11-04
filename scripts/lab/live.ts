/**
 * Live wiring for the lab scripts (`pnpm compare:demo`, `pnpm attacks:run`): the REAL shopping agent tools over
 * - search: the real product search (Channel3 + demo catalog), or fixed lab offers;
 * - scans: a fresh cached scan from the database (read-only), else a real scan (KERNEL + Claude page analysis);
 *   lab scans are not saved, so the app's cache and History stay untouched;
 * - orders: the REAL MoneyGate on an in-memory store with the PayPal SANDBOX client. Lab runs stop at "order
 *   prepared": nobody approves in PayPal, so nothing is ever held or charged.
 * Every model and AI-scan dollar is added to `spend` so the scripts can stop before their budget.
 */
import { agentOrderStatus, compareStores, demoPeersForUrl, parsePaymentRef, type AgentDeps, type SearchResult } from '@voircheck/agent';
import { createDb } from '@voircheck/db';
import { scans } from '@voircheck/db/schema';
import { MemoryGateStore, MoneyGate, PayPalClient } from '@voircheck/paypal';
import { anthropicAnalyzer, assertSafeUrlShape, kernelVisitor, scanStore, type SignalResult } from '@voircheck/scanner';
import { and, desc, eq, gt, like, or } from 'drizzle-orm';
import { fileAiCache } from '../ai-cache';

export const LAB_USER = 'lab-user';

export interface Spend {
  agentUsd: number;
  scanUsd: number;
  kernelSessions: number;
}

export interface LabScan {
  storeId: string;
  url: string;
  cached: boolean;
  verdict: 'SAFE' | 'HOLD' | 'BLOCK';
  score: number;
  signals: readonly SignalResult[];
  hardRules: readonly string[];
}

export interface LabOrder {
  storeId: string;
  storeName: string;
  amount: string;
  outcome: 'order_prepared' | 'refused';
  reason?: string;
  ref?: string;
  /** PayPal sandbox order ID (never approved). */
  paypalOrderId?: string;
}

const env = (k: string) => process.env[k]?.trim() || undefined;

function db() {
  const url = env('DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL is missing');
  return createDb(url);
}

async function freshScan(url: string) {
  const [row] = await db()
    .select()
    .from(scans)
    .where(and(eq(scans.url, url), gt(scans.cacheExpiresAt, new Date())))
    .orderBy(desc(scans.scannedAt))
    .limit(1);
  return row ?? null;
}

async function latestVerdictForStore(storeUrl: string) {
  const base = storeUrl.replace(/\/$/, '');
  const [row] = await db()
    .select({ verdict: scans.verdict })
    .from(scans)
    .where(or(eq(scans.url, base), eq(scans.url, `${base}/`), like(scans.url, `${base.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`)))
    .orderBy(desc(scans.scannedAt))
    .limit(1);
  return row?.verdict;
}

/**
 * One store scan: the app's fresh cached scan when there is one (no new cost), else a real scan. `budget` is checked
 * by the caller before every run; a fresh scan costs one KERNEL session and one Claude page analysis.
 */
export async function labScan(rawUrl: string, spend: Spend, opts: { useCache?: boolean } = {}): Promise<Omit<LabScan, 'storeId'>> {
  const url = new URL(assertSafeUrlShape(rawUrl).href);
  url.hash = '';
  const href = url.href;
  if (opts.useCache !== false) {
    const row = await freshScan(href);
    if (row) return { url: href, cached: true, verdict: row.verdict, score: row.riskScore, signals: row.signals as SignalResult[], hardRules: row.hardRulesTriggered };
  }
  const kernelKey = env('KERNEL_API_KEY');
  const anthropicKey = env('ANTHROPIC_API_KEY');
  if (!kernelKey || !anthropicKey) throw new Error('labScan needs KERNEL_API_KEY and ANTHROPIC_API_KEY');
  const demo = demoPeersForUrl(href, env('DEMO_STORES_BASE_URL'));
  const peers = demo ? await Promise.all(demo.peers.map(async (p) => ({ url: p.url, productTitle: p.productTitle, verdict: await latestVerdictForStore(p.storeUrl) }))) : [];
  spend.kernelSessions += 1;
  const { result, meta } = await scanStore(
    { url: href, peers, productTitle: demo?.productTitle },
    {
      visitor: kernelVisitor({ apiKey: kernelKey, proxyId: env('KERNEL_PROXY_ID') }),
      safeBrowsingKey: env('GOOGLE_SAFE_BROWSING_API_KEY'),
      analyzer: anthropicAnalyzer({ apiKey: anthropicKey, model: env('SCAN_MODEL'), cache: fileAiCache() }),
    },
  );
  spend.scanUsd += meta.ai?.costUsd ?? 0;
  return { url: href, cached: false, verdict: result.verdict, score: result.score, signals: result.signals, hardRules: result.hardRulesTriggered };
}

/** A real compareStores call (the app's own search: Channel3 + the demo stores), top 3 like the app. */
export async function realSearch(query: string, maxPrice: number | null): Promise<SearchResult[] | null> {
  const r = await compareStores(query, { apiKey: env('CHANNEL3_API_KEY'), demoMode: true, demoStoresBaseUrl: env('DEMO_STORES_BASE_URL'), maxPrice });
  return r.status === 'ok' ? r.stores.slice(0, 3) : null;
}

/**
 * VoirCheck's own agent tools, live. `search` defaults to the real search; the attack lab passes fixed offers.
 * `scanUrl` picks the page to scan (demo stores: the product page, like the app).
 */
export function voirCheckDeps(opts: {
  spend: Spend;
  search?: (query: string, maxPrice: number | null) => Promise<SearchResult[] | null>;
  returnUrl?: string;
  /** Scans already run for this lab run, by scanned URL (so an attack page is scanned once, not once per tool call). */
  preScanned?: ReadonlyMap<string, Omit<LabScan, 'storeId'>>;
}) {
  const clientId = env('PAYPAL_CLIENT_ID');
  const clientSecret = env('PAYPAL_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox) are missing');
  // Sandbox only: the client refuses any other host.
  const paypal = new PayPalClient({ clientId, clientSecret });
  const store = new MemoryGateStore();
  const gate = new MoneyGate({ paypal, store });
  const found = new Map<string, SearchResult>();
  const scanIds = new Map<string, string>();
  const scansDone: LabScan[] = [];
  const orders: LabOrder[] = [];
  const search = opts.search ?? realSearch;
  let n = 0;

  const deps: AgentDeps = {
    async searchStores(query, maxPrice) {
      const results = await search(query, maxPrice);
      if (!results?.length) return { status: 'no_results' };
      const stores = results.map((r) => {
        const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
        found.set(id, r);
        store.candidates.set(id, { id, sessionId: 'lab-session', userId: LAB_USER, storeName: r.storeName, storeUrl: r.storeUrl, productTitle: r.title, price: r.price.toFixed(2), currency: r.currency, source: r.source });
        return { storeId: id, storeName: r.storeName.slice(0, 80), productTitle: r.title.slice(0, 120), price: r.price.toFixed(2), currency: r.currency.toUpperCase(), demo: r.source === 'demo' };
      });
      return { status: 'ok', stores, sameProduct: true };
    },
    async scanStore(storeId) {
      const r = found.get(storeId);
      if (!r) return { status: 'unavailable', reason: 'unknown_store' };
      try {
        const target = r.source === 'demo' ? r.productUrl : r.storeUrl;
        const s = opts.preScanned?.get(target) ?? (await labScan(target, opts.spend));
        const id = `scan-${storeId}`;
        store.scans.set(id, { id, url: s.url, verdict: s.verdict, riskScore: s.score, scannedAt: new Date(), cacheExpiresAt: new Date(Date.now() + 24 * 3_600_000) });
        scanIds.set(storeId, id);
        scansDone.push({ storeId, ...s });
        return { status: 'ok', verdict: s.verdict, score: s.score, signals: s.signals, hardRules: s.hardRules };
      } catch (err) {
        console.error('lab scan failed:', err instanceof Error ? err.message : 'unknown error');
        return { status: 'unavailable', reason: 'failed' };
      }
    },
    async createOrder(storeId) {
      const r = await gate.agentStartPurchase({ userId: LAB_USER, candidateId: storeId, scanId: scanIds.get(storeId) ?? null, idempotencyKey: `lab-${storeId}`, returnUrl: opts.returnUrl ?? 'https://voircheck.com/app', cancelUrl: opts.returnUrl ?? 'https://voircheck.com/app' });
      const c = store.candidates.get(storeId);
      if (r.ok) {
        orders.push({ storeId, storeName: c?.storeName ?? '?', amount: r.payment.amount, outcome: 'order_prepared', ref: r.payment.ref, paypalOrderId: r.payment.paypalOrderId });
        return { storeId, status: 'awaiting_buyer_approval', paymentId: r.payment.id, ref: r.payment.ref };
      }
      const reason = r.reason === 'block' || r.reason === 'unverified' || r.reason === 'no_price' || r.reason === 'not_found' ? r.reason : 'other';
      orders.push({ storeId, storeName: c?.storeName ?? '?', amount: c?.price ?? '?', outcome: 'refused', reason });
      return { storeId, status: 'refused', reason };
    },
    async requestPayment(paymentId) {
      // Real MoneyGate: PayPal says the order isn't approved (nobody approves in a lab run), so nothing settles.
      const r = await gate.completeApproval(paymentId, LAB_USER, 'agent');
      const st = r.payment?.status;
      return { paymentId, status: !r.ok || !st || st === 'created' ? 'waiting_for_buyer' : st === 'authorized' || st === 'captured' || st === 'voided' ? st : 'failed' };
    },
    async getOrder(order) {
      const ref = parsePaymentRef(order);
      const row = [...store.payments.values()].find((p) => p.id === order || (ref && p.ref === ref));
      if (!row) return { status: 'not_found' };
      return agentOrderStatus(row.id, { orderId: row.paypalOrderId, status: 'PAYER_ACTION_REQUIRED', intent: 'AUTHORIZE', amount: { value: row.amount, currency: row.currency }, authorizationStatus: null, captureStatus: null }, row.ref);
    },
    async listRecentOrders() {
      return { orders: [] };
    },
    async requestRefund() {
      return { status: 'not_refundable', reason: 'not_found' };
    },
  };
  /** Money that moved: every payment in the gate's store that got past "created". Must stay empty in a lab run. */
  const moneyMoved = () => [...store.payments.values()].filter((p) => p.status !== 'created' && p.status !== 'replaced').map((p) => ({ ref: p.ref, status: p.status, amount: p.amount }));
  return { deps, scansDone, orders, moneyMoved, found };
}
