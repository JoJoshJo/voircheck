import { createHash } from 'node:crypto';
import { getStore, storeSlugForHost } from '@voircheck/shared/stores';
import { z } from 'zod';
import { PayPalApiError, type PayPalClient } from './client';
import {
  approvalLink,
  authorizeOrder,
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

/** Reauthorize: only from day 4 to day 29 of the original authorization, and only once (spike T4). */
export function decideReauthorize(input: { authorizedAt: Date; now: Date; alreadyReauthorized: boolean }): AutopayDecision {
  if (input.alreadyReauthorized) return { allowed: false, reason: 'already reauthorized once' };
  const elapsedDays = (input.now.getTime() - input.authorizedAt.getTime()) / DAY_MS;
  if (elapsedDays < 3) return { allowed: false, reason: 'reauthorize is only allowed from day 4 (inside the 3-day honor period)' };
  if (elapsedDays >= 29) return { allowed: false, reason: 'authorization has expired (day 29)' };
  return { allowed: true };
}

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
});
export const AutopayInput = z.object({ userId: Id, candidateId: Id, scanId: Id.nullable().default(null), idempotencyKey: z.string().min(8).max(100), override: z.boolean().default(false) });
export const PaymentActionInput = z.object({ userId: Id, paymentId: Id });
export const UserCaptureInput = PaymentActionInput.extend({ override: z.boolean().default(false) });

export type GateResult<T = PaymentRow> = { ok: true; payment: T; approvalUrl?: string | null } | { ok: false; reason: string; payment?: PaymentRow };

/** PayPal-Request-Id derived from what the request is about, so repeats map to the same PayPal call. */
export function requestIdFor(...parts: string[]): string {
  return `vc-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)}`;
}

const captureStatus = (c: Capture): PaymentStatus => (c.status === 'COMPLETED' ? 'captured' : c.status === 'PENDING' ? 'capture_pending' : 'capture_denied');
const TERMINAL: PaymentStatus[] = ['captured', 'voided', 'capture_denied', 'failed'];

export interface MoneyGateOptions {
  paypal: PayPalClient;
  store: GateStore;
  now?: () => Date;
}

export class MoneyGate {
  private readonly paypal: PayPalClient;
  private readonly store: GateStore;
  private readonly now: () => Date;

  constructor(opts: MoneyGateOptions) {
    this.paypal = opts.paypal;
    this.store = opts.store;
    this.now = opts.now ?? (() => new Date());
  }

  private audit(userId: string | null, actor: AuditActor, action: string, entityId: string | null, details: Record<string, unknown>, entity = 'payment') {
    return this.store.appendAudit({ userId, actor, action, entity, entityId, details });
  }

  private async verdictFor(scanId: string | null, candidate: CandidateRow) {
    const scan = scanId ? await this.store.getScan(scanId) : null;
    return effectiveVerdict(scan, candidate, this.now());
  }

  /** Approve mode, step 1: AUTHORIZE order for the candidate's stored price. Returns the PayPal approval link. */
  async startApprovePurchase(raw: z.input<typeof StartPurchaseInput>): Promise<GateResult> {
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
    const order = await createOrder(
      this.paypal,
      {
        intent: 'AUTHORIZE',
        amount: toMoney(price, candidate.currency),
        storeSlug,
        storeName: candidate.storeName,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        vaultOnSuccess: input.saveWalletForAutopay,
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
      overrideUsed: false,
    });
    await this.audit(input.userId, 'user', 'order.created', payment.id, { orderId: order.id, intent: 'AUTHORIZE', amount: payment.amount, currency: payment.currency, storeSlug });
    return { ok: true, payment, approvalUrl: approvalLink(order) };
  }

  /**
   * Approve mode, step 2 (after the buyer approved; from the return URL or the CHECKOUT.ORDER.APPROVED webhook):
   * authorize, keep the saved-wallet token ID if any, then settle by verdict.
   */
  async completeApproval(paymentId: string, userId: string, actor: AuditActor = 'system'): Promise<GateResult> {
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
      const vault = authorized.payment_source?.paypal?.attributes?.vault;
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
    const decision = decideCapture({ verdict: v.verdict, trigger: 'system', override: false });
    await this.audit(userId, 'system', `gate.${decision.action}`, payment.id, { verdict: v.verdict, why: v.why, reason: decision.reason, trigger: 'system' });
    if (decision.action === 'capture') return this.doCapture(payment, userId, false, 'system');
    if (decision.action === 'void') return this.doVoid(payment, userId, 'system');
    return { ok: true, payment };
  }

  /** The user tapped Capture on a held payment (override only after the "I understand the risk" step). */
  async userCapture(raw: z.input<typeof UserCaptureInput>): Promise<GateResult> {
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

  /** Releasing held money is always allowed. */
  async userVoid(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
    const input = PaymentActionInput.parse(raw);
    const payment = await this.store.getPaymentForUser(input.paymentId, input.userId);
    if (!payment) return { ok: false, reason: 'payment not found' };
    if (payment.status !== 'authorized' || !payment.authorizationId) return { ok: false, reason: `payment is ${payment.status}`, payment };
    await this.audit(input.userId, 'user', 'gate.void', payment.id, { reason: 'user chose to void', trigger: 'user' });
    return this.doVoid(payment, input.userId, 'user');
  }

  async reauthorize(raw: z.input<typeof PaymentActionInput>): Promise<GateResult> {
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

  /** Auto-pay: verdict + limit check FIRST, then a direct CAPTURE on the saved wallet (spike T5c). */
  async autoPay(raw: z.input<typeof AutopayInput>): Promise<GateResult> {
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

  private async doCapture(payment: PaymentRow, userId: string, overrideUsed: boolean, actor: AuditActor): Promise<GateResult> {
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
