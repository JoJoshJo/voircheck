import 'server-only';
import { AGENT_SYSTEM_PROMPT, agentOrderStatus, AnthropicModel, compareStores, FakeModel, runAgentTurn, shoppingTools, toolkitOrderReader, type AgentDeps, type AgentMessage, type ModelClient, type SearchResult } from '@voircheck/agent';
import { demoPeersForUrl } from '@voircheck/agent/search';
import { assertSafeUrlShape, SsrfError, StoreUrl } from '@voircheck/scanner';
import { parsePaymentRef } from '@voircheck/shared';
import { agentTextEvents, neutralizeFakeNote, type AgentEvent } from './agent-view';
import { paymentIdForRef, recentOrdersForUser, refundableRefsAtStore } from './orders';
import { getPayPal } from './paypal';
import { checkScanLimits } from './rate-limit';
import { anthropicCapReached, DailyCapError, recordSpendQuietly } from './spend';
import { runStoreScan, ScanBusyError } from './scan-runner';
import { canonicalUrl, findFreshScan, finishLinkRequest, recordLinkRequest, recordSearchRequest } from './scans';
import { toScanView } from './scan-view';

/**
 * Server side of the shopping agent. Conversations live in this process's memory (spec 5.16: one web instance, like
 * MoneyGate's lock): the model's history, and per store the URLs and scan IDs it must never be able to choose itself.
 * Lost on restart; the chat then starts over.
 */

interface Conversation {
  userId: string;
  messages: AgentMessage[];
  /** storeId (candidate ID) → what we found, including the URLs the model never sees. */
  stores: Map<string, SearchResult>;
  scans: Map<string, string>;
  /** storeId → its scan, started as soon as search returns it (get_scan_verdict then reuses it). */
  scanJobs: Map<string, Promise<ScanStoreResult>>;
  orders: Map<string, string>;
  payments: Set<string>;
  /** paymentId → the payment status the agent last heard about (so the next turn can tell it what changed). */
  lastStatus: Map<string, string>;
  busy: boolean;
  touchedAt: number;
  /** Model spend so far (logged per turn; the conversation stops at MAX_CONVERSATION_USD). */
  costUsd: number;
}

/** Cost guard on top of the per-user hourly limit: one conversation never spends more than this on the model. */
export const MAX_CONVERSATION_USD = 0.5;

const TTL_MS = 2 * 3_600_000;
const MAX_CONVERSATIONS = 500;
// On globalThis so a dev-server hot reload of this module doesn't drop live conversations.
const g = globalThis as typeof globalThis & { __voircheckAgentConversations?: Map<string, Conversation> };
const conversations = (g.__voircheckAgentConversations ??= new Map<string, Conversation>());

function sweep(now: number) {
  for (const [id, c] of conversations) if (now - c.touchedAt > TTL_MS) conversations.delete(id);
  while (conversations.size >= MAX_CONVERSATIONS) conversations.delete(conversations.keys().next().value!);
}

/** The user's own conversation, or a new one (an unknown or someone else's ID never resumes anything). */
export function openConversation(userId: string, id: string | null): { id: string; conv: Conversation } {
  const now = Date.now();
  sweep(now);
  const found = id ? conversations.get(id) : undefined;
  if (found && found.userId === userId) {
    found.touchedAt = now;
    return { id: id!, conv: found };
  }
  const conv: Conversation = { userId, messages: [], stores: new Map(), scans: new Map(), scanJobs: new Map(), orders: new Map(), payments: new Set(), lastStatus: new Map(), busy: false, touchedAt: now, costUsd: 0 };
  const newId = crypto.randomUUID();
  conversations.set(newId, conv);
  return { id: newId, conv };
}

/**
 * Claude (AGENT_MODEL, default Sonnet 5.5) when ANTHROPIC_API_KEY is set; the scripted FakeModel without a key or with
 * AGENT_MODEL=fake (offline demo). One client per process.
 */
const gm = globalThis as typeof globalThis & { __voircheckAgentModel?: AnthropicModel };
export function agentModel(): { model: ModelClient; kind: 'fake' | 'claude' } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || process.env.AGENT_MODEL === 'fake') return { model: new FakeModel(), kind: 'fake' };
  return { model: (gm.__voircheckAgentModel ??= new AnthropicModel({ apiKey, model: process.env.AGENT_MODEL || undefined })), kind: 'claude' };
}

const STOPPED = {
  en: 'I stopped here to keep this short. Tell me what you’d like to do next.',
  fr: 'Je m’arrête ici pour rester bref. Dites-moi ce que vous voulez faire ensuite.',
} as const;

export class ConversationBudgetError extends Error {
  constructor() {
    super('this conversation reached its model budget');
    this.name = 'ConversationBudgetError';
  }
}

// One Agent Toolkit reader per process (it caches its token for an hour). Read-only get_order, sandbox forced.
const gr = globalThis as typeof globalThis & { __voircheckOrderReader?: ReturnType<typeof toolkitOrderReader> };
function orderReader() {
  return (gr.__voircheckOrderReader ??= toolkitOrderReader({ clientId: process.env.PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '' }));
}

/** A pasted link, through the same guards as "Check a store link": URL shape, then the SSRF-safe canonical form. */
function safeLinkUrl(raw: string): string | null {
  if (!StoreUrl.safeParse(raw).success) return null;
  try {
    return canonicalUrl(assertSafeUrlShape(raw).href);
  } catch {
    return null;
  }
}

const PAYMENT_STATUSES = new Set(['authorized', 'captured', 'capture_pending', 'capture_denied', 'voided', 'cancelled', 'failed']);

type ScanStoreResult = Awaited<ReturnType<AgentDeps['scanStore']>>;

export function webDeps(o: { convId: string; conv: Conversation; userId: string; isGuest: boolean; ip: string; demoMode: boolean; origin: string; send: (e: AgentEvent) => void }): AgentDeps {
  const { conv, userId, send } = o;
  const { gate, store } = getPayPal();

  async function scanOnce(storeId: string): Promise<ScanStoreResult> {
    const found = conv.stores.get(storeId);
    if (!found) return { status: 'unavailable', reason: 'unknown_store' };
    // Demo stores: their product page (the price and copycat checks compare product pages). Real retailers: the
    // store itself (Channel3's buy link is a tracking redirect).
    const url = canonicalUrl(assertSafeUrlShape(found.source === 'demo' ? found.productUrl : found.storeUrl).href);
    send({ type: 'scan_start', storeId });
    try {
      let row = await findFreshScan(url);
      const cached = !!row;
      if (!row) {
        const limit = await checkScanLimits({ userId, isGuest: o.isGuest, ip: o.ip, fresh: true });
        if (!limit.ok) {
          send({ type: 'scan_failed', storeId, reason: 'rate_limited' });
          return { status: 'unavailable', reason: 'rate_limited' };
        }
        row = await runStoreScan({ url, demoMode: o.demoMode, liveView: false, onProgress: (e) => e.type === 'signal' && send({ type: 'scan_signal', storeId, id: e.id, status: e.status }) });
      }
      conv.scans.set(storeId, row.id);
      const view = toScanView(row);
      send({ type: 'scan_done', storeId, scan: view, cached });
      // A store the person already paid now scans BLOCK: tell the agent which orders it can offer to refund.
      const refundablePaidOrders = view.verdict === 'BLOCK' ? await refundableRefsAtStore(userId, row.url).catch(() => []) : [];
      return { status: 'ok', verdict: view.verdict, score: view.score, signals: view.signals, hardRules: view.hardRules, refundablePaidOrders };
    } catch (err) {
      // Today's KERNEL cap was reached, or the app is running its maximum of scans at once: the calm "limit reached" line.
      if (err instanceof DailyCapError || err instanceof ScanBusyError) {
        send({ type: 'scan_failed', storeId, reason: 'rate_limited' });
        return { status: 'unavailable', reason: 'rate_limited' };
      }
      console.error('agent scan failed:', err instanceof Error ? err.message : 'unknown error');
      send({ type: 'scan_failed', storeId, reason: 'failed' });
      return { status: 'unavailable', reason: 'failed' };
    }
  }

  /**
   * One scan per store per conversation, shared by the prefetch and get_scan_verdict. A result that isn't "ok"
   * (limit reached, failed) is forgotten once it's in, so a later get_scan_verdict tries again.
   */
  function ensureScan(storeId: string): Promise<ScanStoreResult> {
    const running = conv.scanJobs.get(storeId);
    if (running) return running;
    const job = scanOnce(storeId).then(
      (r) => {
        if (r.status !== 'ok') conv.scanJobs.delete(storeId);
        return r;
      },
      (err: unknown) => {
        conv.scanJobs.delete(storeId);
        throw err;
      },
    );
    conv.scanJobs.set(storeId, job);
    return job;
  }

  return {
    async searchStores(query, maxPrice) {
      const r = await compareStores(query, { apiKey: process.env.CHANNEL3_API_KEY, demoMode: o.demoMode, demoStoresBaseUrl: process.env.DEMO_STORES_BASE_URL, maxPrice });
      if (r.status === 'unavailable') return { status: 'unavailable' };
      if (r.status === 'no_results') return { status: 'no_results' };
      const picks = r.stores.slice(0, 3);
      const rows = picks.map((s) => ({
        storeName: s.storeName.slice(0, 80),
        storeUrl: s.storeUrl,
        productTitle: s.title.slice(0, 120),
        price: s.price.toFixed(2),
        currency: s.currency.toUpperCase(),
        source: s.source,
      }));
      const { candidateIds } = await recordSearchRequest({ userId, query, demoMode: o.demoMode, stores: rows });
      const stores = rows.map((row, i) => ({ storeId: candidateIds[i]!, storeName: row.storeName, productTitle: row.productTitle, price: row.price, currency: row.currency, demo: row.source === 'demo' }));
      candidateIds.forEach((id, i) => conv.stores.set(id, picks[i]!));
      send({ type: 'stores', stores });
      // Start checking them now, while the model reads the results: it asks for every store's verdict next
      // (the prompt requires it), and get_scan_verdict then reuses these scans. Same path, limits and caps.
      for (const id of candidateIds) ensureScan(id).catch(() => {}); // an error reaches the model on its own call
      return { status: 'ok', stores, sameProduct: r.sameProduct };
    },

    scanStore: (storeId) => ensureScan(storeId),

    async checkLink(raw) {
      // Same path as /api/scans: SSRF-safe URL, cache, the person's scan limits, then runStoreScan (which reserves the
      // KERNEL session and page analysis against today's caps). Check-only: price null and never put in conv.stores,
      // so create_order can't find it and the card shows no Buy button.
      const url = safeLinkUrl(raw);
      if (!url) return { status: 'unavailable', reason: 'invalid_url' };
      const cached = await findFreshScan(url);
      const limit = await checkScanLimits({ userId, isGuest: o.isGuest, ip: o.ip, fresh: !cached });
      if (!limit.ok) return { status: 'unavailable', reason: 'rate_limited' };
      // A link to one of our fictional demo stores gets its name from our config (and is scanned in demo mode).
      const demo = demoPeersForUrl(url, process.env.DEMO_STORES_BASE_URL);
      const site = new URL(url).hostname;
      const fields = { storeName: (demo?.storeName ?? site).slice(0, 80), storeUrl: demo?.storeUrl ?? url, productTitle: (demo?.productTitle ?? site).slice(0, 120), price: null, source: demo ? ('demo' as const) : ('link' as const) };
      const { sessionId, candidateId: storeId } = await recordLinkRequest({ userId, url, demoMode: !!demo, ...fields });
      send({ type: 'stores', stores: [{ storeId, storeName: fields.storeName, productTitle: fields.productTitle, price: null, currency: 'USD', demo: !!demo }] });
      send({ type: 'scan_start', storeId });
      try {
        const row = cached ?? (await runStoreScan({ url, demoMode: !!demo, liveView: false, onProgress: (e) => e.type === 'signal' && send({ type: 'scan_signal', storeId, id: e.id, status: e.status }) }));
        await finishLinkRequest(userId, sessionId, 'done');
        const view = toScanView(row);
        send({ type: 'scan_done', storeId, scan: view, cached: !!cached });
        return { status: 'ok', storeId, scanId: row.id, site, verdict: view.verdict, score: view.score, signals: view.signals, hardRules: view.hardRules };
      } catch (err) {
        await finishLinkRequest(userId, sessionId, 'failed').catch(() => {});
        const busy = err instanceof DailyCapError || err instanceof ScanBusyError;
        send({ type: 'scan_failed', storeId, reason: busy ? 'rate_limited' : 'failed' });
        if (err instanceof SsrfError) return { status: 'unavailable', reason: 'invalid_url' };
        if (busy) return { status: 'unavailable', reason: 'rate_limited' };
        console.error('agent check_link failed:', err instanceof Error ? err.message : 'unknown error');
        return { status: 'unavailable', reason: 'failed' };
      }
    },

    async createOrder(storeId) {
      if (!conv.stores.has(storeId)) return { storeId, status: 'refused', reason: 'not_found' };
      const existing = conv.orders.get(storeId);
      if (existing) {
        const row = await store.getPaymentForUser(existing, userId);
        if (row) return { storeId, status: 'awaiting_buyer_approval', paymentId: existing, ref: row.ref };
      }
      const r = await gate.agentStartPurchase({
        userId,
        candidateId: storeId,
        scanId: conv.scans.get(storeId) ?? null,
        idempotencyKey: `agent-${o.convId}-${storeId}`,
        returnUrl: `${o.origin}/app`,
        cancelUrl: `${o.origin}/app`,
      });
      if (!r.ok) {
        const reason = r.reason === 'block' || r.reason === 'unverified' || r.reason === 'no_price' || r.reason === 'not_found' ? r.reason : 'other';
        send({ type: 'refused', storeId, reason });
        return { storeId, status: 'refused', reason };
      }
      conv.orders.set(storeId, r.payment.id);
      conv.payments.add(r.payment.id);
      conv.lastStatus.set(r.payment.id, r.payment.status);
      send({ type: 'order', storeId, paymentId: r.payment.id, orderId: r.payment.paypalOrderId, ref: r.payment.ref });
      return { storeId, status: 'awaiting_buyer_approval', paymentId: r.payment.id, ref: r.payment.ref };
    },

    async requestPayment(paymentId) {
      if (!conv.payments.has(paymentId)) return { paymentId, status: 'not_found' };
      const r = await gate.completeApproval(paymentId, userId, 'agent');
      const st = r.payment?.status;
      const status = !r.ok || st === 'created' || !st ? 'waiting_for_buyer' : PAYMENT_STATUSES.has(st) ? (st as 'captured') : 'failed';
      if (st) conv.lastStatus.set(paymentId, st);
      send({ type: 'payment', paymentId, status });
      return { paymentId, status };
    },

    async getOrder(order) {
      // A VC reference must be one of the signed-in user's own orders; a payment ID must be from this conversation.
      // Either way the row must be the user's: the PayPal order ID comes from it, never from the model.
      const ref = parsePaymentRef(order);
      const paymentId = ref ? await paymentIdForRef(ref, userId) : conv.payments.has(order) ? order : null;
      if (!paymentId) return { status: 'not_found' };
      const row = await store.getPaymentForUser(paymentId, userId);
      if (!row) return { status: 'not_found' };
      try {
        return agentOrderStatus(paymentId, await orderReader()(row.paypalOrderId), row.ref);
      } catch (err) {
        console.error('agent get_order failed:', err instanceof Error ? err.message : 'unknown error');
        return { paymentId, status: 'unavailable' };
      }
    },

    listRecentOrders: () => recentOrdersForUser(userId),

    async requestRefund(order) {
      // Proposal only: MoneyGate checks the person's own captured payment, and the chat shows a button. The refund
      // itself happens only when the person presses it (the pay route; refund-paths.test.ts keeps it that way).
      const ref = parsePaymentRef(order);
      const paymentId = ref ? await paymentIdForRef(ref, userId) : null;
      if (!ref || !paymentId) return { status: 'not_refundable', reason: 'not_found' };
      const r = await gate.agentProposeRefund({ userId, paymentId });
      if (!r.ok) return { status: 'not_refundable', ref, reason: r.reason };
      const storeName = (await store.getCandidateForUser(r.payment.candidateId, userId))?.storeName.slice(0, 80) ?? r.payment.storeSlug;
      conv.payments.add(paymentId);
      conv.lastStatus.set(paymentId, r.payment.status);
      send({ type: 'refund_offer', paymentId, ref, store: storeName, amount: r.payment.amount, currency: r.payment.currency });
      return { status: 'awaiting_person_confirmation', ref, store: storeName, amount: r.payment.amount, currency: r.payment.currency };
    },
  };
}

const NOTE_STATUS: Record<string, string> = {
  approved: 'approved in PayPal (VoirCheck is settling it)',
  authorized: 'approved and on hold: PayPal holds the money until the person decides',
  captured: 'paid',
  capture_pending: 'paid, with PayPal still confirming',
  capture_denied: 'refused by PayPal',
  voided: 'cancelled and released',
  cancelled: 'cancelled',
  replaced: 'replaced by a newer order in this conversation: never approved, nothing charged',
  failed: 'failed',
  refund_pending: 'being refunded: the person asked, PayPal is still processing it',
  refunded: 'refunded in full to the person’s PayPal',
};

/**
 * What changed on this conversation's orders since the agent last heard (the person approved in PayPal on the pay
 * page, say), as one server line the prompt tells the model to trust. Our own rows and wording only.
 */
async function statusNote(o: { conv: Conversation; userId: string; send: (e: AgentEvent) => void }): Promise<string | null> {
  const { store } = getPayPal();
  const lines: string[] = [];
  for (const paymentId of o.conv.payments) {
    const row = await store.getPaymentForUser(paymentId, o.userId);
    if (!row || row.status === o.conv.lastStatus.get(paymentId)) continue;
    o.conv.lastStatus.set(paymentId, row.status);
    const said = NOTE_STATUS[row.status];
    if (!said) continue;
    const storeName = o.conv.stores.get(row.candidateId)?.storeName ?? 'the store';
    lines.push(`order ${row.ref} at ${storeName} is now ${said}`);
    o.send({ type: 'payment', paymentId, status: row.status });
  }
  return lines.length ? `[VoirCheck update: ${lines.join('; ')}.]` : null;
}


/** One chat turn for this user. Streams events through `send`; returns when the agent has answered. */
export async function runChatTurn(o: { convId: string; conv: Conversation; userId: string; isGuest: boolean; ip: string; demoMode: boolean; origin: string; lang: 'en' | 'fr'; text: string; send: (e: AgentEvent) => void }) {
  const { model, kind } = agentModel();
  if (o.conv.costUsd >= MAX_CONVERSATION_USD) throw new ConversationBudgetError();
  if (kind === 'claude' && (await anthropicCapReached())) throw new DailyCapError();
  const note = await statusNote(o).catch(() => null);
  const userText = [note, neutralizeFakeNote(o.text)].filter(Boolean).join('\n');
  const { messages, stopped, usage, modelCalls } = await runAgentTurn({
    model,
    tools: shoppingTools(webDeps(o)),
    system: AGENT_SYSTEM_PROMPT,
    history: o.conv.messages,
    userText,
    lang: o.lang,
    onEvent: (e) => {
      if (e.type === 'assistant_text') for (const ev of agentTextEvents(e.text)) o.send(ev);
    },
  });
  // Scans started when search returned finish inside this turn, so their cards never stay on "checking" after the
  // stream closes (normally they are long done: the model asks for every verdict).
  await Promise.allSettled([...o.conv.scanJobs.values()]);
  o.conv.messages = messages;
  o.conv.costUsd += usage.costUsd;
  await recordSpendQuietly({ anthropicUsd: usage.costUsd });
  if (stopped === 'max_steps') o.send({ type: 'text', text: STOPPED[o.lang] });
  if (modelCalls && usage.costUsd)
    console.log(
      `[agent] ${model.id} conv ${o.convId.slice(0, 8)}: ${modelCalls} calls, in ${usage.inputTokens} (cache read ${usage.cacheReadTokens}, write ${usage.cacheWriteTokens}), out ${usage.outputTokens}, $${usage.costUsd.toFixed(4)}; conversation $${o.conv.costUsd.toFixed(4)}`,
    );
}
