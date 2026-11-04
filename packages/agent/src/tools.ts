import { HARD_RULES, SIGNAL_IDS, type SignalResult } from '@voircheck/scanner';
import { PAYMENT_REF_RE } from '@voircheck/shared';
import { z } from 'zod';
import type { AgentTool, AnyAgentTool } from './loop';

/**
 * The shopping agent's six tools (spec 5.3 / 5.7 / 5.13). The model only names things by our IDs:
 * - Prices, store URLs and amounts come from our own rows (Channel3 / demo config), never from the model; any extra
 *   field the model sends (price, amount, override) is stripped by the input schemas.
 * - Scan results reach the model as a structured summary in OUR words (verdict, score, signal statuses, hard rules,
 *   one injection flag). Never evidence strings, page text, titles or hidden text: those can carry page content.
 * - Money: create_order prepares an AUTHORIZE order through MoneyGate (which refuses BLOCK / unverified stores);
 *   request_payment asks MoneyGate to settle an approved order. There is no capture, void or override tool.
 * - get_order reads an order's status through the PayPal Agent Toolkit's read-only get_order (spec 5.7). Read only:
 *   the agent names one of its own payments, never a PayPal order ID, and gets status fields back, never payer data.
 * - Every order has VoirCheck's own short reference (VC-7K2F): the agent quotes it, get_order accepts it, and
 *   list_my_recent_orders lists the signed-in person's own recent orders by it (summaries from our rows only).
 */

const Id = z.string().min(1).max(100);
const Ref = z.string().regex(PAYMENT_REF_RE);
const Verdict = z.enum(['SAFE', 'HOLD', 'BLOCK']);

// ---------- store-controlled text ----------

/** Lengths the model sees of store-controlled text (Channel3 results, merchants' own names and titles). */
export const UNTRUSTED_MAX = { storeName: 80, productTitle: 120 } as const;

/**
 * Store-controlled text for the model (security review, M1): NFKC-normalised (so full-width ＜＞ become <>), control
 * and invisible format characters and <> replaced by spaces, whitespace collapsed, length-capped. It is still the
 * store's words: the model sees it only inside an `untrusted` object, and the system prompt says those are data.
 */
export function untrustedText(s: string, max: number): string {
  return s
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const untrusted = (storeName: string, productTitle: string) => ({
  untrusted: { storeName: untrustedText(storeName, UNTRUSTED_MAX.storeName), productTitle: untrustedText(productTitle, UNTRUSTED_MAX.productTitle) },
});

/** search_products as the model sees it: our fields as they are, the store's own words under `untrusted`. */
export function searchForModel(out: SearchOutput): unknown {
  if (out.status !== 'ok') return out;
  return { ...out, stores: out.stores.map(({ storeName, productTitle, ...ours }) => ({ ...ours, ...untrusted(storeName, productTitle) })) };
}

/** list_my_recent_orders as the model sees it: store and item names (from the search) under `untrusted`. */
export function recentOrdersForModel(out: RecentOrdersOutput): unknown {
  return { orders: out.orders.map(({ store, item, ...ours }) => ({ ...ours, ...untrusted(store, item) })) };
}

// ---------- search ----------

export const StoreOffer = z.object({
  storeId: Id,
  storeName: z.string().max(80),
  productTitle: z.string().max(120),
  price: z.string().regex(/^\d+\.\d{2}$/).nullable(),
  currency: z.string().length(3),
  demo: z.boolean(),
});
export type StoreOffer = z.infer<typeof StoreOffer>;

export const SearchInput = z.object({
  query: z.string().trim().min(2).max(120),
  maxPrice: z.number().positive().max(100_000).nullable().default(null),
});
export const SearchOutput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), stores: z.array(StoreOffer).max(3), sameProduct: z.boolean() }),
  z.object({ status: z.literal('no_results') }),
  z.object({ status: z.literal('unavailable') }),
]);
export type SearchOutput = z.infer<typeof SearchOutput>;

// ---------- scan verdict ----------

export const SignalSummary = z.object({
  id: z.enum(SIGNAL_IDS),
  status: z.enum(['pass', 'warn', 'fail', 'unavailable']),
  points: z.number().int().min(0).max(100),
  /** Our own fixed wording for this signal + status. */
  meaning: z.string().max(80),
});
export const ScanSummary = z.object({
  storeId: Id,
  verdict: Verdict,
  score: z.number().int().min(0).max(100),
  hardRules: z.array(z.enum(HARD_RULES)),
  signals: z.array(SignalSummary).max(SIGNAL_IDS.length),
  /** The page hid text that addresses AI agents (hidden-text extract). A flag only: the text itself never reaches the agent. */
  pageTriedToInstructAgents: z.boolean(),
  /**
   * BLOCK only: the person's own paid orders at this store that can still be refunded (VoirCheck references, from our
   * rows). The agent offers request_refund; it never refunds.
   */
  refundablePaidOrders: z.array(Ref).max(5).optional(),
});
export type ScanSummary = z.infer<typeof ScanSummary>;
export const ScanOutput = z.union([ScanSummary, z.object({ storeId: Id, status: z.literal('unavailable'), reason: z.enum(['unknown_store', 'rate_limited', 'failed']) })]);
export type ScanOutput = z.infer<typeof ScanOutput>;

const MEANING: Record<(typeof SIGNAL_IDS)[number], Record<SignalResult['status'], string>> = {
  domain_age: { pass: 'the domain is not new', warn: 'the domain is fairly new', fail: 'the domain is very new', unavailable: "couldn't check the domain age" },
  ssl_redirects: { pass: 'HTTPS and redirects look normal', warn: 'something is off with HTTPS or redirects', fail: 'no valid HTTPS or a suspicious redirect', unavailable: "couldn't check HTTPS" },
  price: { pass: 'the price is in line with other stores', warn: 'the price is unusually low', fail: 'the price is far below other stores', unavailable: "couldn't compare the price" },
  ai_page: { pass: 'the page reads like a normal shop', warn: 'the page has some warning signs', fail: 'the page has strong scam signs', unavailable: 'page analysis not available' },
  threat_list: { pass: 'not on threat lists', warn: 'a threat list has concerns', fail: 'listed on a threat list', unavailable: "couldn't check threat lists" },
  clone: { pass: "doesn't copy another store", warn: 'looks a bit like another store', fail: 'copies another store', unavailable: "couldn't check for copies" },
};

/** What a finished scan looks like to the agent. Built field by field; nothing from the page is copied. */
export function scanSummaryForAgent(storeId: string, scan: { verdict: z.infer<typeof Verdict>; score: number; signals: readonly SignalResult[]; hardRules: readonly string[]; refundablePaidOrders?: readonly string[] }): ScanSummary {
  const refunds = scan.verdict === 'BLOCK' ? (scan.refundablePaidOrders ?? []).filter((r) => Ref.safeParse(r).success).slice(0, 5) : [];
  const injection = scan.signals.some((s) => s.collected?.pages.some((p) => p.hiddenText?.some((h) => h.possibleInjection)));
  return ScanSummary.parse({
    storeId,
    verdict: scan.verdict,
    score: scan.score,
    hardRules: scan.hardRules.filter((r): r is (typeof HARD_RULES)[number] => (HARD_RULES as readonly string[]).includes(r)),
    signals: scan.signals.map((s) => ({ id: s.id, status: s.status, points: s.points, meaning: MEANING[s.id][s.status] })),
    pageTriedToInstructAgents: injection,
    ...(refunds.length ? { refundablePaidOrders: refunds } : {}),
  });
}

// ---------- money ----------

export const RefusalReason = z.enum(['block', 'unverified', 'no_price', 'not_found', 'other']);
export const CreateOrderOutput = z.discriminatedUnion('status', [
  z.object({ storeId: Id, status: z.literal('awaiting_buyer_approval'), paymentId: Id, ref: Ref }),
  z.object({ storeId: Id, status: z.literal('refused'), reason: RefusalReason }),
]);
export type CreateOrderOutput = z.infer<typeof CreateOrderOutput>;
export const PaymentOutcome = z.enum(['waiting_for_buyer', 'authorized', 'captured', 'capture_pending', 'capture_denied', 'voided', 'cancelled', 'failed', 'not_found']);
export const RequestPaymentOutput = z.object({ paymentId: Id, status: PaymentOutcome });
export type RequestPaymentOutput = z.infer<typeof RequestPaymentOutput>;
const PayPalStatus = z.string().regex(/^[A-Z_]{2,40}$/);
export const GetOrderOutput = z.discriminatedUnion('status', [
  z.object({
    paymentId: Id,
    ref: Ref.optional(),
    status: z.literal('ok'),
    orderStatus: PayPalStatus,
    intent: PayPalStatus.nullable(),
    amount: z.object({ value: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.string().regex(/^[A-Z]{3}$/) }).nullable(),
    authorizationStatus: PayPalStatus.nullable(),
    captureStatus: PayPalStatus.nullable(),
  }),
  z.object({ paymentId: Id.optional(), status: z.enum(['not_found', 'unavailable']) }),
]);
export type GetOrderOutput = z.infer<typeof GetOrderOutput>;

/** One of the person's own recent orders, from our rows only (store and item names as shown in our search). */
export const OrderSummary = z.object({
  ref: Ref,
  store: z.string().max(80),
  item: z.string().max(120),
  amount: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.string().length(3),
  /** expired: never approved and past PayPal's 6-hour order window; nothing was charged or held. */
  status: z.enum(['waiting_for_buyer', 'expired', 'approved', 'authorized', 'captured', 'capture_pending', 'capture_denied', 'voided', 'cancelled', 'replaced', 'failed', 'refund_pending', 'refunded']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const RecentOrdersOutput = z.object({ orders: z.array(OrderSummary).max(10) });
export type RecentOrdersOutput = z.infer<typeof RecentOrdersOutput>;

/**
 * request_refund only PROPOSES: the person gets a "Request refund" button, and only their click (MoneyGate.userRefund)
 * asks PayPal. Our own fields only.
 */
export const RefundRefusalReason = z.enum(['not_found', 'not_captured', 'already_refunded', 'refund_pending', 'too_old']);
export const RequestRefundOutput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('awaiting_person_confirmation'), ref: Ref, store: z.string().max(80), amount: z.string().regex(/^\d+\.\d{2}$/), currency: z.string().length(3) }),
  z.object({ status: z.literal('not_refundable'), ref: Ref.optional(), reason: RefundRefusalReason }),
]);
export type RequestRefundOutput = z.infer<typeof RequestRefundOutput>;

/** What the server provides. Each call is already scoped to the signed-in user and this conversation. */
export interface AgentDeps {
  searchStores(query: string, maxPrice: number | null): Promise<SearchOutput>;
  /** The finished scan (fresh or cached) of a store from this conversation's search. */
  scanStore(storeId: string): Promise<{ status: 'ok'; verdict: z.infer<typeof Verdict>; score: number; signals: readonly SignalResult[]; hardRules: readonly string[]; refundablePaidOrders?: readonly string[] } | { status: 'unavailable'; reason: 'unknown_store' | 'rate_limited' | 'failed' }>;
  /** MoneyGate.agentStartPurchase: AUTHORIZE order at our price, or a refusal. */
  createOrder(storeId: string): Promise<CreateOrderOutput>;
  /** MoneyGate.completeApproval: settles an approved order by verdict. */
  requestPayment(paymentId: string): Promise<RequestPaymentOutput>;
  /** Agent Toolkit get_order (read only): one of this conversation's payment IDs, or a VC reference of the person's own order. */
  getOrder(order: string): Promise<GetOrderOutput>;
  /** The signed-in person's own most recent orders (newest first). */
  listRecentOrders(): Promise<RecentOrdersOutput>;
  /** MoneyGate.agentProposeRefund + a "Request refund" button in the chat. Never refunds by itself. */
  requestRefund(ref: string): Promise<RequestRefundOutput>;
}

export function shoppingTools(deps: AgentDeps): AnyAgentTool[] {
  const search: AgentTool<z.infer<typeof SearchInput>, SearchOutput> = {
    name: 'search_products',
    description: 'Find one item at up to 3 stores. Returns store IDs, product titles and prices from our product search. Pass maxPrice when the person gives a budget.',
    input: SearchInput,
    output: SearchOutput,
    run: ({ query, maxPrice }) => deps.searchStores(query, maxPrice),
    forModel: searchForModel,
  };
  const verdict: AgentTool<{ storeId: string }, ScanOutput> = {
    name: 'get_scan_verdict',
    description: "Check a store from the search results with VoirCheck's scanner. Returns the verdict (SAFE, HOLD or BLOCK), the risk score and each signal's status. Call it for every store before recommending one.",
    input: z.object({ storeId: Id }),
    output: ScanOutput,
    run: async ({ storeId }) => {
      const r = await deps.scanStore(storeId);
      return r.status === 'ok' ? scanSummaryForAgent(storeId, r) : { storeId, status: 'unavailable' as const, reason: r.reason };
    },
  };
  const order: AgentTool<{ storeId: string }, CreateOrderOutput> = {
    name: 'create_order',
    description: 'Prepare a PayPal order for the item at this store, at the price from the search. Nothing is held or charged yet: the person still has to approve it in PayPal. Only after they approve does PayPal hold the money, until VoirCheck’s check passes. VoirCheck refuses BLOCK stores and stores it cannot verify.',
    input: z.object({ storeId: Id }),
    output: CreateOrderOutput,
    run: ({ storeId }) => deps.createOrder(storeId),
  };
  const pay: AgentTool<{ paymentId: string }, RequestPaymentOutput> = {
    name: 'request_payment',
    description: "Ask VoirCheck to settle an order the person approved in PayPal. The server decides from the scan: SAFE is captured, HOLD stays held for the person, BLOCK is released. Returns the payment's status.",
    input: z.object({ paymentId: Id }),
    output: RequestPaymentOutput,
    run: ({ paymentId }) => deps.requestPayment(paymentId),
  };
  const status: AgentTool<{ order: string }, GetOrderOutput> = {
    name: 'get_order',
    description:
      "Look up an order's current status in PayPal (read only; it changes nothing). Pass the paymentId from create_order, or the order's VoirCheck reference (like VC-7K2F) from this chat or from list_my_recent_orders. Returns PayPal's order status, the amount and the authorization / capture status.",
    input: z.object({ order: z.string().trim().min(1).max(100) }),
    output: GetOrderOutput,
    run: ({ order }) => deps.getOrder(order),
  };
  const recent: AgentTool<Record<string, never>, RecentOrdersOutput> = {
    name: 'list_my_recent_orders',
    description:
      "List the signed-in person's own most recent orders (up to 10, newest first): VoirCheck reference, store, item, amount, VoirCheck's payment status (\"expired\" = never approved in time, nothing charged) and date. Use it when they ask about an order that isn't in this chat. Read only.",
    input: z.object({}),
    output: RecentOrdersOutput,
    run: () => deps.listRecentOrders(),
    forModel: recentOrdersForModel,
  };
  const refund: AgentTool<{ ref: string }, RequestRefundOutput> = {
    name: 'request_refund',
    description:
      "Offer the person a full refund of one of their own paid orders, by its VoirCheck reference (like VC-7K2F). This does NOT refund anything: it shows them a \"Request refund\" button, and only their click asks PayPal. Returns awaiting_person_confirmation with the amount, or not_refundable with the reason (not paid yet, already refunded, refund in progress, too old for PayPal, not found).",
    input: z.object({ ref: z.string().trim().min(1).max(20) }),
    output: RequestRefundOutput,
    run: ({ ref }) => deps.requestRefund(ref),
  };
  return [search, verdict, order, pay, status, recent, refund];
}

export const TOOL_NAMES = ['search_products', 'get_scan_verdict', 'create_order', 'request_payment', 'get_order', 'list_my_recent_orders', 'request_refund'] as const;
