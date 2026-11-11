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
  /** The store in one hedged sentence, by its OVERALL verdict (our words): describe the store by this, not by one check. */
  summary: z.string().max(240),
  /**
   * BLOCK only: the person's own paid orders at this store that can still be refunded (VoirCheck references, from our
   * rows). The agent offers request_refund; it never refunds.
   */
  refundablePaidOrders: z.array(Ref).max(5).optional(),
});
export type ScanSummary = z.infer<typeof ScanSummary>;
export const ScanOutput = z.union([ScanSummary, z.object({ storeId: Id, status: z.literal('unavailable'), reason: z.enum(['unknown_store', 'rate_limited', 'failed']) })]);
export type ScanOutput = z.infer<typeof ScanOutput>;

/**
 * check_link: a link the person pasted, checked like "Check a store link". Our summary only (a hedged sentence in our
 * words, the verdict, each check's meaning, the evidence page's path), never page text. Pasted links are check-only:
 * nothing can be bought from them (buyable is always false; create_order doesn't know the store).
 */
const Site = z.string().max(253).regex(/^[a-z0-9.-]+$/);
export const CheckLinkOutput = z.union([
  ScanSummary.extend({
    status: z.literal('ok'),
    site: Site,
    evidence: z.string().regex(/^\/app\/scans\/[A-Za-z0-9-]{1,64}$/),
    buyable: z.literal(false),
  }),
  z.object({ status: z.literal('unavailable'), reason: z.enum(['invalid_url', 'rate_limited', 'failed']) }),
]);
export type CheckLinkOutput = z.infer<typeof CheckLinkOutput>;

/** The hedged sentence for a checked link: how the shop LOOKS, in our own words (spec 5.12). */
export function hedgedSummary(scan: { verdict: z.infer<typeof Verdict>; signals: readonly { id: string; status: string; meaning: string }[] }): string {
  const warned = scan.signals.filter((s) => s.status === 'warn' || s.status === 'fail');
  if (scan.verdict === 'BLOCK') {
    const why = scan.signals.filter((s) => s.status === 'fail').slice(0, 2).map((s) => s.meaning);
    return `Looks like a fake shop${why.length ? `: ${why.join(', and ')}` : ''}. VoirCheck won't pay it.`;
  }
  if (scan.verdict === 'HOLD') return `Something looks a bit off${warned[0] ? `: ${warned[0].meaning}` : ''}.`;
  const parts = [!warned.length ? 'no warning signs' : null, scan.signals.some((s) => s.id === 'price' && s.status === 'pass') ? 'fair price' : null].filter(Boolean);
  return `Looks safe to buy${parts.length ? `, ${parts.join(', ')}` : ''}.`;
}

const MEANING: Record<(typeof SIGNAL_IDS)[number], Record<SignalResult['status'], string>> = {
  domain_age: { pass: 'the domain is not new', warn: 'the domain is fairly new', fail: 'the domain is very new', unavailable: "couldn't check the domain age" },
  ssl_redirects: { pass: 'HTTPS and redirects look normal', warn: 'something is off with HTTPS or redirects', fail: 'no valid HTTPS or a suspicious redirect', unavailable: "couldn't check HTTPS" },
  price: { pass: 'the price is in line with other stores', warn: 'the price is unusually low', fail: 'the price is far below other stores', unavailable: "couldn't compare the price" },
  ai_page: { pass: 'the page reads like a normal shop', warn: 'the page has some warning signs', fail: 'the page has strong scam signs', unavailable: 'page analysis not available' },
  threat_list: { pass: 'not on threat lists', warn: 'a threat list has concerns', fail: 'listed on a threat list', unavailable: "couldn't check threat lists" },
  clone: { pass: "doesn't copy another store", warn: 'looks a bit like another store', fail: 'copies another store', unavailable: "couldn't check for copies" },
};

/**
 * A check line must not say more than the store's overall verdict: on a store that isn't BLOCK, a failed page check
 * reads as warning signs, never as "scam" (live wig run, Nov 4: a HOLD shop was called "a scam").
 */
const NOT_BLOCK_FAIL: Partial<Record<(typeof SIGNAL_IDS)[number], string>> = { ai_page: 'the page has several warning signs' };
const meaningFor = (id: (typeof SIGNAL_IDS)[number], status: SignalResult['status'], verdict: z.infer<typeof Verdict>) =>
  (status === 'fail' && verdict !== 'BLOCK' && NOT_BLOCK_FAIL[id]) || MEANING[id][status];

/** What a finished scan looks like to the agent. Built field by field; nothing from the page is copied. */
export function scanSummaryForAgent(storeId: string, scan: { verdict: z.infer<typeof Verdict>; score: number; signals: readonly SignalResult[]; hardRules: readonly string[]; refundablePaidOrders?: readonly string[] }): ScanSummary {
  const refunds = scan.verdict === 'BLOCK' ? (scan.refundablePaidOrders ?? []).filter((r) => Ref.safeParse(r).success).slice(0, 5) : [];
  // Both signs only (the prompt-injection hard rule: the page analysis found an attempt AND its quote matches our own
  // rule). A hidden mention of an AI, such as a shop's own assistant widget, is not enough.
  const injection = scan.hardRules.includes('prompt_injection_attempt');
  const signals = scan.signals.map((s) => ({ id: s.id, status: s.status, points: s.points, meaning: meaningFor(s.id, s.status, scan.verdict) }));
  return ScanSummary.parse({
    storeId,
    verdict: scan.verdict,
    score: scan.score,
    hardRules: scan.hardRules.filter((r): r is (typeof HARD_RULES)[number] => (HARD_RULES as readonly string[]).includes(r)),
    signals,
    pageTriedToInstructAgents: injection,
    summary: hedgedSummary({ verdict: scan.verdict, signals }),
    ...(refunds.length ? { refundablePaidOrders: refunds } : {}),
  });
}

/**
 * A scan summary as the MODEL sees it (Nov 11, to save tokens on free providers): the same facts in fewer words. Checks
 * that passed are listed by name only; every other check keeps its status and our fixed meaning. Points per check are
 * dropped (the total score stays). Nothing is added: still only our own fields, never page text.
 */
export function scanForModel(out: object): unknown {
  const s = out as unknown as Partial<ScanSummary> & Record<string, unknown>;
  if (!Array.isArray(s.signals)) return out;
  const { signals, ...rest } = s;
  return {
    ...rest,
    passed: signals.filter((x) => x.status === 'pass').map((x) => x.id),
    checks: signals.filter((x) => x.status !== 'pass').map(({ id, status, meaning }) => ({ id, status, meaning })),
  };
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
  /**
   * A link the person pasted: SSRF-checked, rate-limited, budget-reserved and cached like "Check a store link". Its
   * store card shows in the chat; it is never added to the stores create_order knows.
   */
  checkLink(url: string): Promise<
    | { status: 'ok'; storeId: string; scanId: string; site: string; verdict: z.infer<typeof Verdict>; score: number; signals: readonly SignalResult[]; hardRules: readonly string[] }
    | { status: 'unavailable'; reason: 'invalid_url' | 'rate_limited' | 'failed' }
  >;
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
    description: 'Find one item at up to 3 stores: store IDs, titles and prices from our product search. Pass maxPrice for a budget.',
    input: SearchInput,
    output: SearchOutput,
    run: ({ query, maxPrice }) => deps.searchStores(query, maxPrice),
    forModel: searchForModel,
  };
  const verdict: AgentTool<{ storeId: string }, ScanOutput> = {
    name: 'get_scan_verdict',
    description: "VoirCheck's check of a store from the search: verdict (SAFE, HOLD or BLOCK), a one-sentence summary by that overall verdict, the score, the checks that passed and what the others found. Call it for every store before recommending one.",
    input: z.object({ storeId: Id }),
    output: ScanOutput,
    run: async ({ storeId }) => {
      const r = await deps.scanStore(storeId);
      return r.status === 'ok' ? scanSummaryForAgent(storeId, r) : { storeId, status: 'unavailable' as const, reason: r.reason };
    },
    forModel: scanForModel,
  };
  const link: AgentTool<{ url: string }, CheckLinkOutput> = {
    name: 'check_link',
    description:
      "Check a store link the person pasted (copy it exactly): VoirCheck's summary, verdict, checks and evidence page. Check-only: you can't buy from it; offer to search for the item instead.",
    input: z.object({ url: z.string().trim().min(1).max(2048) }),
    output: CheckLinkOutput,
    run: async ({ url }) => {
      const r = await deps.checkLink(url);
      if (r.status !== 'ok') return { status: 'unavailable' as const, reason: r.reason };
      return { ...scanSummaryForAgent(r.storeId, r), status: 'ok' as const, site: r.site, evidence: `/app/scans/${r.scanId}`, buyable: false as const };
    },
    forModel: scanForModel,
  };
  const order: AgentTool<{ storeId: string }, CreateOrderOutput> = {
    name: 'create_order',
    description: 'Prepare a PayPal order at this store, at the search price. Nothing is held or charged until the person approves it in PayPal. VoirCheck refuses BLOCK stores and stores it cannot verify.',
    input: z.object({ storeId: Id }),
    output: CreateOrderOutput,
    run: ({ storeId }) => deps.createOrder(storeId),
  };
  const pay: AgentTool<{ paymentId: string }, RequestPaymentOutput> = {
    name: 'request_payment',
    description: "Settle an order the person approved in PayPal. VoirCheck's server decides: SAFE is captured, HOLD stays held, BLOCK is released. Returns the payment status.",
    input: z.object({ paymentId: Id }),
    output: RequestPaymentOutput,
    run: ({ paymentId }) => deps.requestPayment(paymentId),
  };
  const status: AgentTool<{ order: string }, GetOrderOutput> = {
    name: 'get_order',
    description:
      "Read an order's status in PayPal (changes nothing). Pass the paymentId from create_order or a VoirCheck reference (VC-7K2F). Returns the order status, amount and authorization / capture status.",
    input: z.object({ order: z.string().trim().min(1).max(100) }),
    output: GetOrderOutput,
    run: ({ order }) => deps.getOrder(order),
  };
  const recent: AgentTool<Record<string, never>, RecentOrdersOutput> = {
    name: 'list_my_recent_orders',
    description:
      "The person's own recent orders (up to 10, newest first): reference, store, item, amount, status (\"expired\" = never approved in time, nothing charged), date. For an order not in this chat. Read only.",
    input: z.object({}),
    output: RecentOrdersOutput,
    run: () => deps.listRecentOrders(),
    forModel: recentOrdersForModel,
  };
  const refund: AgentTool<{ ref: string }, RequestRefundOutput> = {
    name: 'request_refund',
    description:
      "Offer a full refund of one of the person's own paid orders, by reference (VC-7K2F). It does NOT refund: it shows a \"Request refund\" button, and only their click asks PayPal. Returns awaiting_person_confirmation with the amount, or not_refundable with the reason.",
    input: z.object({ ref: z.string().trim().min(1).max(20) }),
    output: RequestRefundOutput,
    run: ({ ref }) => deps.requestRefund(ref),
  };
  return [search, verdict, link, order, pay, status, recent, refund];
}

export const TOOL_NAMES = ['search_products', 'get_scan_verdict', 'check_link', 'create_order', 'request_payment', 'get_order', 'list_my_recent_orders', 'request_refund'] as const;
