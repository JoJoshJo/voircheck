import { createHash } from 'node:crypto';
import { getStore, storeSlugForHost } from '@voircheck/shared/stores';
import { z } from 'zod';
import { PayPalApiError, type PayPalClient } from './client';
import {
  approvalLink,
  authorizeOrder,
  createVaultPaymentToken,
  createVaultSetupToken,
  captureAuthorization,
  chargeVaultedWallet,
  createOrder,
  firstAuthorization,
  firstCapture,
  getOrder,
  reauthorizeAuthorization,
  toMoney,
  voidAuthorization,
  type Authorization,
  type Capture,
} from './orders';
import type { AuditActor, CandidateRow, GateStore, PaymentRow, PaymentStatus, ScanRow, Verdict } from './store';

/**
 * THE MONEY GATE (spec 5.6 / 5.7 / 5.17 #5). Server-side only; the AI can request, never decide.
 * - Amount, currency and store always come from our own candidate/scan rows. Request inputs are IDs only;
 *   any price or store a browser sends is stripped by the input schemas below.
 * - SAFE → capture. HOLD → capture only on explicit user action. BLOCK → capture only with explicit user
 *   override, which is never allowed in Auto-pay.
 * - A stale or missing scan is "can't verify": never captured automatically.
 * - Auto-pay checks the verdict BEFORE creating the CAPTURE order (there is no authorization to gate later).
 * - Every decision, allowed or refused, writes an audit_log row.
 * - Refunds: full refunds of the person's own captured payments, run only on the person's own button (userRefund).
 *   The agent can only check that one is possible (agentProposeRefund); no agent path moves money back.
 */

const DAY_MS = 86_400_000;

/** What the gate acts on: a fresh scan's verdict, or UNVERIFIED (stale/missing/mismatched scan). */
export type EffectiveVerdict = Verdict | 'UNVERIFIED';

export function effectiveVerdict(scan: ScanRow | null, candidate: Pick<CandidateRow, 'storeUrl'>, now: Date): { verdict: EffectiveVerdict; why: string } {
  if (!scan) return { verdict: 'UNVERIFIED', why: 'no scan' };
  if (!scanCoversStore(scan.url, candidate.storeUrl)) return { verdict: 'UNVERIFIED', why: 'scan is for a different store' };
  if (now.getTime() >= scan.cacheExpiresAt.getTime()) return { verdict: 'UNVERIFIED', why: 'scan is stale' };
  return { verdict: scan.verdict, why: 'fresh scan' };
}

/** A scan covers a store when it's on the same origin and inside the store's path (demo stores share one host). */
export function scanCoversStore(scanUrl: string, storeUrl: string): boolean {
  try {
    const s = new URL(scanUrl);
    const c = new URL(storeUrl);
    const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
    if (s.protocol !== c.protocol || strip(s.host) !== strip(c.host)) return false;
    const base = c.pathname.replace(/\/+$/, '');
    return base === '' || s.pathname === base || s.pathname.startsWith(`${base}/`);
  } catch {
    return false;
  }
}

/** custom_id for PayPal: the demo store's slug, or a slug of the retailer's domain. */
export function storeSlugFor(c: Pick<CandidateRow, 'storeUrl' | 'source'>): string {
  const url = new URL(c.storeUrl);
  if (c.source === 'demo') {
    const slug = storeSlugForHost(url.host) ?? url.pathname.match(/^\/s\/([^/]+)/)?.[1];
    if (!slug || !getStore(slug)) throw new Error('demo candidate does not point at a known demo store');
    return slug;
  }
  return url.hostname.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 127);
}

// ---------- pure decisions (unit-tested branch by branch) ----------

export type CaptureDecision =
  | { action: 'capture'; overrideUsed: boolean; reason: string }
  | { action: 'hold'; reason: string }
  | { action: 'void'; reason: string }
  | { action: 'refuse'; reason: string };

/**
 * After an approve-mode authorization. `trigger: 'system'` = automatic settle right after authorization;
 * `trigger: 'user'` = the user tapped Capture (with `override` only after "I understand the risk").
 */
export function decideCapture(input: { verdict: EffectiveVerdict; trigger: 'system' | 'user'; override: boolean }): CaptureDecision {
  const { verdict, trigger, override } = input;
  if (trigger === 'system') {
    if (verdict === 'SAFE') return { action: 'capture', overrideUsed: false, reason: 'SAFE verdict' };
    if (verdict === 'BLOCK') return { action: 'void', reason: 'BLOCK verdict' };
    return { action: 'hold', reason: verdict === 'HOLD' ? 'HOLD verdict: waiting for the user' : "can't verify the store: waiting for the user" };
  }
  if (verdict === 'BLOCK') {
    return override ? { action: 'capture', overrideUsed: true, reason: 'BLOCK verdict, user override confirmed' } : { action: 'refuse', reason: 'BLOCK verdict needs an explicit override' };
  }
  return { action: 'capture', overrideUsed: false, reason: `${verdict} verdict, explicit user action` };
}

export type AutopayDecision = { allowed: true } | { allowed: false; reason: string };

/** Auto-pay: SAFE + within the user's limit only; no override exists here, ever. */
export function decideAutopay(input: {
  verdict: EffectiveVerdict;
  autopayEnabled: boolean;
  autopayLimit: string | null;
  amount: string;
  currency: string;
  hasVaultToken: boolean;
  overrideRequested: boolean;
}): AutopayDecision {
  if (input.overrideRequested) return { allowed: false, reason: 'override is never allowed in Auto-pay' };
  if (!input.autopayEnabled) return { allowed: false, reason: 'Auto-pay is off' };
  if (!input.hasVaultToken) return { allowed: false, reason: 'no saved PayPal wallet' };
  if (input.verdict !== 'SAFE') return { allowed: false, reason: input.verdict === 'UNVERIFIED' ? "can't verify the store" : `${input.verdict} verdict` };
  if (input.currency !== 'USD') return { allowed: false, reason: 'Auto-pay limit is in USD' };
  if (input.autopayLimit === null) return { allowed: false, reason: 'no Auto-pay limit set' };
  if (Number(input.amount) > Number(input.autopayLimit)) return { allowed: false, reason: 'amount is over the Auto-pay limit' };
  return { allowed: true };
}

/** Why the gate refuses an order the agent asked for (codes; the agent words them in the user's language). */
export type AgentRefusal = 'block' | 'unverified' | 'no_price' | 'not_found';

/**
 * The agent may only prepare orders at stores with a fresh SAFE or HOLD scan. BLOCK and can't-verify stores are refused
 * before any order exists: "Pay anyway" on a BLOCK store is the user's own action on the store card, never the agent's.
 */
export function decideAgentOrder(verdict: EffectiveVerdict): { allowed: true } | { allowed: false; reason: AgentRefusal } {
  if (verdict === 'BLOCK') return { allowed: false, reason: 'block' };
  if (verdict === 'UNVERIFIED') return { allowed: false, reason: 'unverified' };
  return { allowed: true };
}

/** Reauthorize: only from day 4 to day 29 of the original authorization, and only once (spike T4). */
export function decideReauthorize(input: { authorizedAt: Date; now: Date; alreadyReauthorized: boolean }): AutopayDecision {
  if (input.alreadyReauthorized) return { allowed: false, reason: 'already reauthorized once' };
  const elapsedDays = (input.now.getTime() - input.authorizedAt.getTime()) / DAY_MS;
  if (elapsedDays < 3) return { allowed: false, reason: 'reauthorize is only allowed from day 4 (inside the 3-day honor period)' };
  if (elapsedDays >= 29) return { allowed: false, reason: 'authorization has expired (day 29)' };
  return { allowed: true };
}

/** PayPal accepts refunds for 180 days after capture. */
export const REFUND_WINDOW_MS = 180 * DAY_MS;

export type RefundRefusal = 'not_captured' | 'already_refunded' | 'refund_pending' | 'too_old';

/**
 * One full refund per captured payment. The window is counted from the order's creation, which is never after the
 * capture: at worst we stop a few days before PayPal would.
 */
export function decideRefund(p: Pick<PaymentRow, 'status' | 'captureId' | 'createdAt'>, now: Date): { allowed: true } | { allowed: false; reason: RefundRefusal } {
  if (p.status === 'refunded') return { allowed: false, reason: 'already_refunded' };
  if (p.status === 'refund_pending') return { allowed: false, reason: 'refund_pending' };
  if (p.status !== 'captured' || !p.captureId) return { allowed: false, reason: 'not_captured' };
  if (now.getTime() - p.createdAt.getTime() >= REFUND_WINDOW_MS) return { allowed: false, reason: 'too_old' };
  return { allowed: true };
}

/**
 * What a refund call reports. `unknown` = PayPal didn't answer: nothing is assumed, and a retry reuses the same
 * PayPal-Request-Id, so PayPal returns the first refund instead of making a second one.
 */
export type RefundOutcome =
  | { kind: 'refund'; refundId: string; status: string }
  | { kind: 'already_refunded' }
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; message: string };

/** Runs one full refund of a capture (the web app passes the PayPal Agent Toolkit's create_refund). */
export type Refunder = (input: { captureId: string; requestId: string }) => Promise<RefundOutcome>;

// ---------- inputs: IDs only (anything else, like a browser-sent price, is stripped) ----------

const Id = z.string().min(1).max(100);
const Url = z.string().url().max(2048);
export const StartPurchaseInput = z.object({
  userId: Id,
  candidateId: Id,
  scanId: Id.nullable().default(null),
  idempotencyKey: z.string().min(8).max(100),
  returnUrl: Url,
  cancelUrl: Url,
  saveWalletForAutopay: z.boolean().default(false),
  /** "Pay anyway" on a BLOCK store, after the user ticked "I understand the risk". Never in Auto-pay. */
  override: z.boolean().default(false),
});
/** What the agent can ask for: IDs only. No override and no wallet flag exist here, so the agent can't send them. */
export const AgentPurchaseInput = z.object({ userId: Id, candidateId: Id, scanId: Id.nullable().default(null), idempotencyKey: z.string().min(8).max(100), returnUrl: Url, cancelUrl: Url });
export const WalletSetupInput = z.object({ userId: Id, returnUrl: Url, cancelUrl: Url });
export const WalletConfirmInput = z.object({ userId: Id, setupTokenId: z.string().min(5).max(100) });
export const AutopayInput = z.object({ userId: Id, candidateId: Id, scanId: Id.nullable().default(null), idempotencyKey: z.string().min(8).max(100), override: z.boolean().default(false) });
export const PaymentActionInput = z.object({ userId: Id, paymentId: Id });
export const UserCaptureInput = PaymentActionInput.extend({ override: z.boolean().default(false) });

export type GateResult<T = PaymentRow> = { ok: true; payment: T; approvalUrl?: string | null } | { ok: false; reason: string; payment?: PaymentRow };

/** PayPal-Request-Id derived from what the request is about, so repeats map to the same PayPal call. */
export function requestIdFor(...parts: string[]): string {
  return `vc-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)}`;
}

const captureStatus = (c: Capture): PaymentStatus => (c.status === 'COMPLETED' ? 'captured' : c.status === 'PENDING' ? 'capture_pending' : 'capture_denied');
// replaced: the agent made a newer order in the same conversation; a late approval of the old one is never authorized.
const TERMINAL: PaymentStatus[] = ['captured', 'voided', 'capture_denied', 'failed', 'replaced'];

export interface MoneyGateOptions {
  paypal: PayPalClient;
  store: GateStore;
  now?: () => Date;
  /** Without one, refunds are refused ("unavailable"). */
  refunder?: Refunder;
}

/**
 * Per-key serialization. PayPal-Request-Id only deduplicates a repeat that arrives AFTER the first call finished;
 * two identical calls in flight at once both go through (seen live: React's double effect charged twice). So every
 * action that creates an order or moves money runs one at a time per purchase/payment key; the duplicate then gets
 * PayPal's stored result (same request id) or the already-settled row. Single-process lock: VoirCheck runs one
 * web instance (spec 5.16); a second instance would need a database lock instead.
 */
class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}
const LOCK = new KeyedLock();

export class MoneyGate {
  private readonly paypal: PayPalClient;
  private readonly store: GateStore;
  private readonly now: () => Date;
  private readonly refunder: Refunder | null;

  constructor(opts: MoneyGateOptions) {
    this.paypal = opts.paypal;
    this.store = opts.store;
    this.now = opts.now ?? (() => new Date());
    this.refunder = opts.refunder ?? null;
  }

  private audit(userId: string | null, actor: AuditActor, action: string, entityId: string | null, details: Record<string, unknown>, entity = 'payment') {
    return this.store.appendAudit({ userId, actor, action, entity, entityId, details });
  }

  private async verdictFor(scanId: string | null, candidate: CandidateRow) {
    const scan = scanId ? await this.store.getScan(scanId) : null;
    return effectiveVerdict(scan, candidate, this.now());
  }

  async startApprovePurchase(raw: z.input<typeof StartPurchaseInput>): Promise<GateResult> {
    return LOCK.run(`purchase:${String(raw.userId)}:${String(raw.candidateId)}:${String(raw.idempotencyKey)}`, () => this._startApprovePurchase(raw));
  }

  /** Approve mode, step 1: AUTHORIZE order for the candidate's stored price. Returns the PayPal approval link. */
  private async _startApprovePurchase(raw: z.input<typeof StartPurchaseInput>): Promise<GateResult> {
    const input = StartPurchaseInput.parse(raw);
    const candidate = await this.store.getCandidateForUser(input.candidateId, input.userId);
    if (!candidate) {
      await this.audit(input.userId, 'user', 'purchase.refused', null, { reason: 'candidate not found', candidateId: input.candidateId });
      return { ok: false, reason: 'candidate not found' };
    }
    if (candidate.price === null) {
      await this.audit(input.userId, 'user', 'purchase.refused', null, { reason: 'no known price', candidateId: candidate.id });
      return { ok: false, reason: 'no known price for this store' };
    }
    const price = candidate.price;
    const storeSlug = storeSlugFor(candidate);
    // Auto-pay on but no saved wallet yet: this approval also saves the wallet (spike T5: vault with purchase).
    // Decided here from our own rows, never by the browser. Never on a "Pay anyway" order.
    const [profile, savedWallet] = await Promise.all([this.store.getProfile(input.userId), this.store.getActiveVaultToken(input.userId)]);
    const saveWallet = !input.override && (input.saveWalletForAutopay || (!!profile?.autopayEnabled && !savedWallet));
    const order = await createOrder(
      this.paypal,
      {
        intent: 'AUTHORIZE',
        amount: toMoney(price, candidate.currency),
        storeSlug,
        storeName: candidate.storeName,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        vaultOnSuccess: saveWallet,
      },
      requestIdFor('order', input.userId, candidate.id, input.idempotencyKey),
    );
    const payment = await this.store.insertPayment({
      userId: input.userId,
      sessionId: candidate.sessionId,
      candidateId: candidate.id,
      scanId: input.scanId,
      paypalOrderId: order.id,
      authorizationId: null,
      captureId: null,
      storeSlug,
      amount: toMoney(price, candidate.currency).value,
      currency: candidate.currency,
      status: 'created',
      mode: 'approve',
      // Recorded up front: the user already confirmed "I understand the risk" before this order existed.
      overrideUsed: input.override,
    });
    if (saveWallet) await this.audit(input.userId, 'user', 'wallet.save_requested', payment.id, { reason: 'Auto-pay is on and no PayPal is saved yet' });
    if (input.override) await this.audit(input.userId, 'user', 'override.confirmed', payment.id, { scanId: input.scanId, note: 'user confirmed "I understand the risk"' });
    await this.audit(input.userId, 'user', 'order.created', payment.id, { orderId: order.id, intent: 'AUTHORIZE', amount: payment.amount, currency: payment.currency, storeSlug, override: input.override });
    return { ok: true, payment, approvalUrl: approvalLink(order) };
  }

  /**
   * The shopping agent's create_order: refuse BLOCK / can't-verify stores up front (audited as the agent), otherwise
   * the same AUTHORIZE order as the user's own checkout, never with an override. Settling stays with completeApproval.
   */
  async agentStartPurchase(raw: z.input<typeof AgentPurchaseInput>): Promise<GateResult | { ok: false; reason: AgentRefusal }> {
    const input = AgentPurchaseInput.parse(raw);
    const refuse = async (reason: AgentRefusal, details: Record<string, unknown> = {}) => {
      await this.audit(input.userId, 'agent', 'agent.order_refused', null, { reason, candidateId: input.candidateId, scanId: input.scanId, ...details });
      return { ok: false as const, reason };
    };
    const candidate = await this.store.getCandidateForUser(input.candidateId, input.userId);
    if (!candidate) return refuse('not_found');
    if (candidate.price === null) return refuse('no_price');
    const v = await this.verdictFor(input.scanId, candidate);
    const decision = decideAgentOrder(v.verdict);
    if (!decision.allowed) return refuse(decision.reason, { verdict: v.verdict, why: v.why });
    await this.audit(input.userId, 'agent', 'agent.order_requested', null, { verdict: v.verdict, candidateId: candidate.id, scanId: input.scanId });
    const started = await this.startApprovePurchase({ ...input, override: false, saveWalletForAutopay: false });
    if (started.ok) await this.replaceOlderOrders(candidate.sessionId, input.userId, started.payment.id);
    return started;
  }

  /**
   * The agent's new order replaces the conversation's older ones still waiting for approval: they become "replaced,
   * nothing charged" here (local status only; an unapproved PayPal order holds no money and expires by itself).
   */
  private async replaceOlderOrders(sessionId: string, userId: string, newPaymentId: string) {
    for (const old of await this.store.getUnapprovedInSession(sessionId, userId)) {
      if (old.id === newPaymentId) continue;
      await LOCK.run(`payment:${old.id}`, async () => {
        const now = await this.store.getPaymentForUser(old.id, userId);
        if (now?.status !== 'created') return; // approved or settled meanwhile: leave it
        await this.store.updatePayment(old.id, { status: 'replaced' });
        await this.audit(userId, 'agent', 'order.replaced', old.id, { by: newPaymentId });
      });
    }
  }

  async completeApproval(paymentId: string, userId: string, actor: AuditActor = 'system'): Promise<GateResult> {
    return LOCK.run(`payment:${paymentId}`, () => this._completeApproval(paymentId, userId, actor));
  }

  /**
   * Approve mode, step 2 (after the buyer approved; from the return URL or the CHECKOUT.ORDER.APPROVED webhook):
   * authorize, keep the saved-wallet token ID if any, then settle by verdict.
   */
  private async _completeApproval(paymentId: string, userId: string, actor: AuditActor = 'system'): Promise<GateResult> {
    let payment = await this.store.getPaymentForUser(paymentId, userId);
    if (!payment) return { ok: false, reason: 'payment not found' };
    if (payment.mode !== 'approve') return { ok: false, reason: 'not an approve-mode payment', payment };
    if (TERMINAL.includes(payment.status)) return { ok: true, payment };

    if (!payment.authorizationId) {
      const order = await getOrder(this.paypal, payment.paypalOrderId);
      if (order.status !== 'APPROVED' && order.status !== 'COMPLETED') return { ok: false, reason: `order is ${order.status}, not approved yet`, payment };
      const authorized = order.status === 'COMPLETED' ? order : await authorizeOrder(this.paypal, payment.paypalOrderId, requestIdFor('authorize', payment.id));
      const auth = firstAuthorization(authorized);
      if (!auth) return { ok: false, reason: 'PayPal returned no authorization', payment };
      let vault = authorized.payment_source?.paypal?.attributes?.vault;
      // The vault ID isn't always on the authorize response (spike T5); the order has it once vaulting finished.
      if (!vault?.id && (await this.store.hasAudit('payment', payment.id, 'wallet.save_requested'))) {
        vault = (await getOrder(this.paypal, payment.paypalOrderId)).payment_source?.paypal?.attributes?.vault;
      }
      // Only the vault token ID and its status are kept; never the buyer's email, name or account details.
      if (vault?.id) await this.store.saveVaultToken(userId, vault.id, vault.status ?? 'VAULTED');
      payment = await this.store.updatePayment(payment.id, { authorizationId: auth.id, status: 'authorized' });
      await this.audit(userId, actor, 'authorization.created', payment.id, { authorizationId: auth.id, walletSaved: !!vault?.id });
    }
    return this.settle(payment, userId);
  }

  /** Automatic decision right after authorization: SAFE → capture, HOLD/can't verify → hold, BLOCK → void. */
  private async settle(payment: PaymentRow, userId: string): Promise<GateResult> {
    const candidate = await this.store.getCandidateForUser(payment.candidateId, userId);
    if (!candidate) return { ok: false, reason: 'candidate not found', payment };
    const v = await this.verdictFor(payment.scanId, candidate);
    // A "Pay anyway" order carries the user's explicit, already-audited override; everything else settles as the system.
    const trigger = payment.overrideUsed ? 'user' : 'system';
    const decision = decideCapture({ verdict: v.verdict, trigger, override: payment.overrideUsed });
    await this.audit(userId, trigger === 'user' ? 'user' : 'system', `gate.${decision.action}`, payment.id, { verdict: v.verdict, why: v.why, reason: decision.reason, trigger, override: payment.overrideUsed });
    if (decision.action === 'capture') return this.doCapture(payment, userId, decision.overrideUsed, trigger === 'user' ? 'user' : 'system');
    if (decision.action === 'void') return this.doVoid(payment, userId, 'system');
    return { ok: true, payment };
  }

  async userCapture(raw: z.input<typeof UserCaptureInput>): Promise<GateResult> {
    return LOCK.run(`payment:${String(raw.paymentId)}`, () => this._userCapture(raw));
  }

  /** The user tapped Capture on a held payment (override only after the "I understand the risk" step). */
  private async _userCapture(raw: z.input<typeof UserCaptureInput>): Promise<GateResult> {
    const input = UserCaptureInput.parse(raw);
    const payment = await this.store.getPaymentForUser(input.paymentId, input.userId);
    if (!payment) return { ok: false, reason: 'payment not found' };
    if (payment.mode !== 'approve') {
      await this.audit(input.userId, 'user', 'gate.refuse', payment.id, { reason: 'auto-pay payments have no user capture step', override: input.override });
      return { ok: false, reason: 'auto-pay payments have no user capture step', payment };
    }
    if (payment.status !== 'authorized' || !payment.authorizationId) return { ok: false, reason: `payment is ${payment.status}`, payment };
    const candidate = await this.store.getCandidateForUser(payment.candidateId, input.userId);
    if (!candidate) return { ok: false, reason: 'candidate not found', payment };
    const v = await this.verdictFor(payment.scanId, candidate);
    const decision = decideCapture({ verdict: v.verdict, trigger: 'user', override: input.override });
    await this.audit(input.userId, 'user', `gate.${decision.action}`, payment.id, { verdict: v.verdict, why: v.why, reason: decision.reason, trigger: 'user', override: input.override });
    if (decision.action !== 'capture') return { ok: false, reason: decision.reason, payment };
    return this.doCapture(payment, input.userId, decision.overrideUsed, 'user');
  }

  async cancelPurchase(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    return LOCK.run(`payment:${String(raw.paymentId)}`, () => this._cancelPurchase(raw));
  }

  /** The buyer closed or cancelled the PayPal popup before approving: nothing was held, the order is dropped. */
  private async _cancelPurchase(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    const input = PaymentActionInput.parse(raw);
    const payment = await this.store.getPaymentForUser(input.paymentId, input.userId);
    if (!payment) return { ok: false, reason: 'payment not found' };
    if (payment.status !== 'created') return { ok: true, payment };
    const order = await getOrder(this.paypal, payment.paypalOrderId);
    if (order.status === 'APPROVED') return { ok: false, reason: 'already approved', payment }; // approval won the race: finish it instead
    const updated = await this.store.updatePayment(payment.id, { status: 'cancelled' });
    await this.audit(input.userId, 'user', 'order.cancelled', payment.id, { orderStatus: order.status });
    return { ok: true, payment: updated };
  }

  /**
   * Standalone wallet save (no purchase). DISABLED in the app (not exposed by any route): the sandbox app's token
   * lacks the `vault/payment-tokens/readwrite` scope, so /v3/vault/setup-tokens returns 403 NOT_AUTHORIZED
   * (Oct 29). The wallet is saved during the first approved purchase instead (vault with purchase, spike T5).
   * Kept, with tests, in case that scope is granted later.
   *
   * Auto-pay setup, step 1: a vault setup token the buyer approves in the PayPal popup (no purchase).
   */
  async startWalletSetup(raw: z.input<typeof WalletSetupInput>): Promise<{ setupTokenId: string }> {
    const input = WalletSetupInput.parse(raw);
    const token = await createVaultSetupToken(this.paypal, { returnUrl: input.returnUrl, cancelUrl: input.cancelUrl }, requestIdFor('vault-setup', input.userId, String(this.now().getTime())));
    await this.audit(input.userId, 'user', 'vault.setup_started', token.id, {}, `vault_setup:${input.userId}`);
    return { setupTokenId: token.id };
  }

  /** Auto-pay setup, step 2: exchange the approved setup token for a payment token and keep only its ID. */
  async confirmWalletSetup(raw: z.input<typeof WalletConfirmInput>): Promise<{ ok: true } | { ok: false; reason: string }> {
    const input = WalletConfirmInput.parse(raw);
    // Only a setup token this user started can be confirmed for this user.
    if (!(await this.store.hasAudit(`vault_setup:${input.userId}`, input.setupTokenId, 'vault.setup_started'))) return { ok: false, reason: 'unknown setup token' };
    const token = await createVaultPaymentToken(this.paypal, input.setupTokenId, requestIdFor('vault-confirm', input.setupTokenId));
    await this.store.saveVaultToken(input.userId, token.id, 'VAULTED');
    await this.audit(input.userId, 'user', 'vault.saved', null, {}, 'vault_token');
    return { ok: true };
  }

  async userVoid(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    return LOCK.run(`payment:${String(raw.paymentId)}`, () => this._userVoid(raw));
  }

  /** Releasing held money is always allowed. */
  private async _userVoid(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    const input = PaymentActionInput.parse(raw);
    const payment = await this.store.getPaymentForUser(input.paymentId, input.userId);
    if (!payment) return { ok: false, reason: 'payment not found' };
    if (payment.status !== 'authorized' || !payment.authorizationId) return { ok: false, reason: `payment is ${payment.status}`, payment };
    await this.audit(input.userId, 'user', 'gate.void', payment.id, { reason: 'user chose to void', trigger: 'user' });
    return this.doVoid(payment, input.userId, 'user');
  }

  async reauthorize(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    return LOCK.run(`payment:${String(raw.paymentId)}`, () => this._reauthorize(raw));
  }

  private async _reauthorize(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    const input = PaymentActionInput.parse(raw);
    const payment = await this.store.getPaymentForUser(input.paymentId, input.userId);
    if (!payment) return { ok: false, reason: 'payment not found' };
    if (payment.status !== 'authorized' || !payment.authorizationId) return { ok: false, reason: `payment is ${payment.status}`, payment };
    const auth = await this.paypal.request<Authorization>('GET', `/v2/payments/authorizations/${encodeURIComponent(payment.authorizationId)}`);
    const decision = decideReauthorize({
      authorizedAt: new Date(auth.create_time ?? payment.createdAt),
      now: this.now(),
      alreadyReauthorized: await this.store.hasAudit('payment', payment.id, 'authorization.reauthorized'),
    });
    if (!decision.allowed) {
      await this.audit(input.userId, 'user', 'reauthorize.refused', payment.id, { reason: decision.reason });
      return { ok: false, reason: decision.reason, payment };
    }
    const fresh = await reauthorizeAuthorization(this.paypal, payment.authorizationId, requestIdFor('reauthorize', payment.id));
    const updated = await this.store.updatePayment(payment.id, { authorizationId: fresh.id });
    await this.audit(input.userId, 'user', 'authorization.reauthorized', payment.id, { previousAuthorizationId: payment.authorizationId, authorizationId: fresh.id });
    return { ok: true, payment: updated };
  }

  async autoPay(raw: z.input<typeof AutopayInput>): Promise<GateResult> {
    return LOCK.run(`autopay:${String(raw.userId)}:${String(raw.candidateId)}:${String(raw.idempotencyKey)}`, () => this._autoPay(raw));
  }

  /** Auto-pay: verdict + limit check FIRST, then a direct CAPTURE on the saved wallet (spike T5c). */
  private async _autoPay(raw: z.input<typeof AutopayInput>): Promise<GateResult> {
    const input = AutopayInput.parse(raw);
    const refuse = async (reason: string, details: Record<string, unknown> = {}) => {
      await this.audit(input.userId, 'agent', 'autopay.refused', null, { reason, candidateId: input.candidateId, scanId: input.scanId, ...details });
      return { ok: false as const, reason };
    };
    const candidate = await this.store.getCandidateForUser(input.candidateId, input.userId);
    if (!candidate) return refuse('candidate not found');
    if (candidate.price === null) return refuse('no known price for this store');
    const [profile, vault, v] = await Promise.all([this.store.getProfile(input.userId), this.store.getActiveVaultToken(input.userId), this.verdictFor(input.scanId, candidate)]);
    const amount = toMoney(candidate.price, candidate.currency);
    const decision = decideAutopay({
      verdict: v.verdict,
      autopayEnabled: profile?.autopayEnabled ?? false,
      autopayLimit: profile?.autopayLimit ?? null,
      amount: amount.value,
      currency: candidate.currency,
      hasVaultToken: !!vault,
      overrideRequested: input.override,
    });
    if (!decision.allowed) return refuse(decision.reason, { verdict: v.verdict, why: v.why, amount: amount.value, limit: profile?.autopayLimit ?? null, override: input.override });

    const storeSlug = storeSlugFor(candidate);
    await this.audit(input.userId, 'agent', 'autopay.allowed', null, { verdict: v.verdict, amount: amount.value, limit: profile?.autopayLimit, candidateId: candidate.id, storeSlug });
    const order = await chargeVaultedWallet(
      this.paypal,
      { amount, storeSlug, storeName: candidate.storeName, vaultId: vault!.paypalVaultTokenId },
      requestIdFor('autopay', input.userId, candidate.id, input.idempotencyKey),
    );
    const capture = firstCapture(order);
    const payment = await this.store.insertPayment({
      userId: input.userId,
      sessionId: candidate.sessionId,
      candidateId: candidate.id,
      scanId: input.scanId,
      paypalOrderId: order.id,
      authorizationId: null,
      captureId: capture?.id ?? null,
      storeSlug,
      amount: amount.value,
      currency: candidate.currency,
      status: capture ? captureStatus(capture) : 'failed',
      mode: 'auto',
      overrideUsed: false,
    });
    await this.audit(input.userId, 'agent', 'autopay.captured', payment.id, { orderId: order.id, captureId: capture?.id ?? null, status: payment.status });
    return { ok: true, payment };
  }

  /**
   * The agent's request_refund: checks only. The person's own button then calls userRefund; nothing here moves money.
   */
  async agentProposeRefund(raw: z.input<typeof PaymentActionInput>): Promise<{ ok: true; payment: PaymentRow } | { ok: false; reason: RefundRefusal | 'not_found' }> {
    const input = PaymentActionInput.parse(raw);
    const payment = await this.store.getPaymentForUser(input.paymentId, input.userId);
    if (!payment) {
      await this.audit(input.userId, 'agent', 'agent.refund_refused', null, { reason: 'not_found', paymentId: input.paymentId });
      return { ok: false, reason: 'not_found' };
    }
    const decision = decideRefund(payment, this.now());
    if (!decision.allowed) {
      await this.audit(input.userId, 'agent', 'agent.refund_refused', payment.id, { reason: decision.reason, status: payment.status });
      return { ok: false, reason: decision.reason };
    }
    await this.audit(input.userId, 'agent', 'agent.refund_proposed', payment.id, { amount: payment.amount, currency: payment.currency });
    return { ok: true, payment };
  }

  async userRefund(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    return LOCK.run(`payment:${String(raw.paymentId)}`, () => this._userRefund(raw));
  }

  /** The person tapped "Request refund" (chat card or History): full refund of their own captured payment. */
  private async _userRefund(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    const input = PaymentActionInput.parse(raw);
    const payment = await this.store.getPaymentForUser(input.paymentId, input.userId);
    if (!payment) return { ok: false, reason: 'payment not found' };
    const decision = decideRefund(payment, this.now());
    if (!decision.allowed) {
      await this.audit(input.userId, 'user', 'refund.refused', payment.id, { reason: decision.reason, status: payment.status });
      // A repeat tap after the refund went through is not an error.
      return decision.reason === 'already_refunded' || decision.reason === 'refund_pending' ? { ok: true, payment } : { ok: false, reason: decision.reason, payment };
    }
    if (!this.refunder) {
      await this.audit(input.userId, 'user', 'refund.refused', payment.id, { reason: 'refunds unavailable' });
      return { ok: false, reason: 'refunds are unavailable right now', payment };
    }
    await this.audit(input.userId, 'user', 'refund.requested', payment.id, { amount: payment.amount, currency: payment.currency });
    let out: RefundOutcome;
    try {
      out = await this.refunder({ captureId: payment.captureId!, requestId: requestIdFor('refund', payment.id) });
    } catch (err) {
      out = { kind: 'unknown', message: err instanceof Error ? err.message.slice(0, 200) : 'refund call failed' };
    }
    if (out.kind === 'refund' && (out.status === 'COMPLETED' || out.status === 'PENDING')) {
      const updated = await this.store.updatePayment(payment.id, { refundId: out.refundId, status: out.status === 'COMPLETED' ? 'refunded' : 'refund_pending' });
      await this.audit(input.userId, 'user', 'payment.refunded', payment.id, { refundId: out.refundId, refundStatus: out.status, amount: payment.amount, currency: payment.currency });
      return { ok: true, payment: updated };
    }
    if (out.kind === 'already_refunded') {
      // Refunded outside VoirCheck (the PayPal dashboard): record what PayPal says.
      const updated = await this.store.updatePayment(payment.id, { status: 'refunded' });
      await this.audit(input.userId, 'user', 'payment.refunded', payment.id, { note: 'PayPal reports the capture is already fully refunded' });
      return { ok: true, payment: updated };
    }
    const message = out.kind === 'refund' ? `refund ${out.status}` : out.message;
    await this.audit(input.userId, 'user', out.kind === 'unknown' ? 'payment.refund_unknown' : 'payment.refund_failed', payment.id, { error: message });
    return { ok: false, reason: out.kind === 'unknown' ? "PayPal didn't answer; nothing changed here. Try again." : 'PayPal refused the refund; nothing changed', payment };
  }

  /** Another path (the webhook, a second tab) may have settled this payment meanwhile: act only on a still-open hold. */
  private async stillHeld(payment: PaymentRow, userId: string): Promise<PaymentRow | null> {
    const fresh = await this.store.getPaymentForUser(payment.id, userId);
    return fresh && fresh.status === 'authorized' && fresh.authorizationId ? fresh : null;
  }

  private async doCapture(payment: PaymentRow, userId: string, overrideUsed: boolean, actor: AuditActor): Promise<GateResult> {
    const open = await this.stillHeld(payment, userId);
    if (!open) {
      const now = await this.store.getPaymentForUser(payment.id, userId);
      return now?.status === 'captured' ? { ok: true, payment: now } : { ok: false, reason: `payment is already ${now?.status ?? 'gone'}`, payment: now ?? payment };
    }
    payment = open;
    try {
      const capture = await captureAuthorization(this.paypal, payment.authorizationId!, requestIdFor('capture', payment.id));
      const updated = await this.store.updatePayment(payment.id, { captureId: capture.id, status: captureStatus(capture), overrideUsed });
      await this.audit(userId, actor, 'payment.captured', payment.id, { captureId: capture.id, status: updated.status, overrideUsed });
      return { ok: true, payment: updated };
    } catch (err) {
      await this.audit(userId, actor, 'payment.capture_failed', payment.id, { error: err instanceof PayPalApiError ? err.message : 'capture failed' });
      return { ok: false, reason: 'PayPal capture failed; nothing was charged', payment };
    }
  }

  private async doVoid(payment: PaymentRow, userId: string, actor: AuditActor): Promise<GateResult> {
    const open = await this.stillHeld(payment, userId);
    if (!open) {
      const now = await this.store.getPaymentForUser(payment.id, userId);
      return now?.status === 'voided' ? { ok: true, payment: now } : { ok: false, reason: `payment is already ${now?.status ?? 'gone'}`, payment: now ?? payment };
    }
    payment = open;
    try {
      await voidAuthorization(this.paypal, payment.authorizationId!, requestIdFor('void', payment.id));
      const updated = await this.store.updatePayment(payment.id, { status: 'voided' });
      await this.audit(userId, actor, 'payment.voided', payment.id, { authorizationId: payment.authorizationId });
      return { ok: true, payment: updated };
    } catch (err) {
      await this.audit(userId, actor, 'payment.void_failed', payment.id, { error: err instanceof PayPalApiError ? err.message : 'void failed' });
      return { ok: false, reason: 'PayPal void failed; the hold expires on its own', payment };
    }
  }
}
