import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { GetOrderOutput } from './tools';

/**
 * PayPal Agent Toolkit (spec 5.7). The agent's instance is read-only: ONLY `get_order` is enabled. Its `create_order` is
 * CAPTURE-intent and priced by the model, and `pay_order` captures, so neither is ever configured; money still moves
 * only through MoneyGate.
 * - Sandbox is forced: the Toolkit defaults to the LIVE API when `context.sandbox` is missing.
 * - The Toolkit keeps its first access token forever, and sandbox tokens expire after ~3–8h, so the instance is
 *   rebuilt every hour.
 * - The order comes back reduced to status fields; payer name, email and address never leave this file.
 */
export const TOOLKIT_CONFIGURATION = { actions: { orders: { get: true } }, context: { sandbox: true } };

export interface OrderStatusView {
  orderId: string;
  status: string;
  intent: string | null;
  amount: { value: string; currency: string } | null;
  authorizationStatus: string | null;
  captureStatus: string | null;
}

/** The slice of the Toolkit we use (the AI SDK tool's execute). */
export interface ToolkitLike {
  getTools(): Record<string, { execute?: (args: never, options: { toolCallId: string; messages: [] }) => PromiseLike<unknown> }>;
}
type Execute<A> = (args: A, options: { toolCallId: string; messages: [] }) => PromiseLike<unknown>;

const TOOLKIT_TTL_MS = 3_600_000;
const short = (v: unknown, n = 40) => (typeof v === 'string' ? v.slice(0, n) : null);

/** Only status fields, whatever else PayPal sends. */
export function orderStatusView(raw: unknown): OrderStatusView | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { id?: unknown; status?: unknown; intent?: unknown; purchase_units?: Array<{ amount?: { value?: unknown; currency_code?: unknown }; payments?: { authorizations?: Array<{ status?: unknown }>; captures?: Array<{ status?: unknown }> } }> };
  if (typeof o.id !== 'string' || typeof o.status !== 'string') return null;
  const pu = o.purchase_units?.[0];
  const value = short(pu?.amount?.value, 20);
  const currency = short(pu?.amount?.currency_code, 3);
  return {
    orderId: o.id.slice(0, 40),
    status: o.status.slice(0, 40),
    intent: short(o.intent),
    amount: value && currency ? { value, currency } : null,
    authorizationStatus: short(pu?.payments?.authorizations?.[0]?.status),
    captureStatus: short(pu?.payments?.captures?.[0]?.status),
  };
}

/** `(orderId) => status view | null`. The caller must only pass order IDs from the user's own payment rows. */
export function toolkitOrderReader(opts: { clientId: string; clientSecret: string; now?: () => number; makeToolkit?: () => ToolkitLike }) {
  const now = opts.now ?? Date.now;
  const make = opts.makeToolkit ?? (() => new PayPalAgentToolkit({ clientId: opts.clientId, clientSecret: opts.clientSecret, configuration: TOOLKIT_CONFIGURATION }) as unknown as ToolkitLike);
  let cached: { toolkit: ToolkitLike; at: number } | null = null;

  return async (orderId: string): Promise<OrderStatusView | null> => {
    if (!/^[A-Z0-9-]{5,40}$/.test(orderId)) return null;
    if (!cached || now() - cached.at > TOOLKIT_TTL_MS) cached = { toolkit: make(), at: now() };
    const getOrder = cached.toolkit.getTools().get_order?.execute as Execute<{ id: string }> | undefined;
    if (!getOrder) throw new Error('Agent Toolkit get_order is not available');
    const out = await getOrder({ id: orderId }, { toolCallId: `get-order-${orderId}`, messages: [] });
    let parsed: unknown = out;
    if (typeof out === 'string') {
      try {
        parsed = JSON.parse(out);
      } catch {
        return null;
      }
    }
    return orderStatusView(parsed);
  };
}

/** The get_order tool's result for one of the user's payments. Anything that doesn't fit the strict schema is "unavailable". */
export function agentOrderStatus(paymentId: string, view: OrderStatusView | null, ref?: string): GetOrderOutput {
  if (!view) return { paymentId, status: 'unavailable' };
  const r = GetOrderOutput.safeParse({ paymentId, ...(ref ? { ref } : {}), status: 'ok', orderStatus: view.status, intent: view.intent, amount: view.amount, authorizationStatus: view.authorizationStatus, captureStatus: view.captureStatus });
  return r.success ? r.data : { paymentId, status: 'unavailable' };
}

/**
 * Refunds (spec 5.7, decided Nov 3): MoneyGate runs the Toolkit's `create_refund` server-side, only after the person's
 * own button. This instance is separate from the agent's and is never given to the model, so the agent can't call it.
 * - Only `payments.createRefund`; sandbox forced.
 * - The Toolkit sends PayPal-Request-Id only from `context.request_id`, fixed per instance, so each refund gets its own
 *   instance keyed on the payment: a repeat returns PayPal's first refund instead of making a second one. (A new
 *   instance also means a fresh access token.)
 * - No amount is passed: PayPal refunds the full captured amount.
 */
export function refundToolkitConfiguration(requestId: string) {
  return { actions: { payments: { createRefund: true } }, context: { sandbox: true, request_id: requestId } };
}

/** Same shape as @voircheck/paypal's RefundOutcome (this package doesn't depend on it). */
export type ToolkitRefundOutcome = { kind: 'refund'; refundId: string; status: string } | { kind: 'already_refunded' } | { kind: 'error'; message: string } | { kind: 'unknown'; message: string };

const PAYPAL_ID = /^[A-Za-z0-9_-]{5,64}$/;

/**
 * Reads what create_refund returned. It never throws on a PayPal error; it returns JSON: the refund
 * (`{id, status}`), an error `{ok:false, code, status, message}`, or `{error:{message}}`.
 * No answer or a PayPal 5xx is "unknown" (PayPal may have refunded): never reported as failed or done.
 */
export function refundOutcome(raw: unknown): ToolkitRefundOutcome {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return { kind: 'unknown', message: 'unreadable answer from the Toolkit' };
    }
  }
  if (!v || typeof v !== 'object') return { kind: 'unknown', message: 'empty answer from the Toolkit' };
  const o = v as { id?: unknown; status?: unknown; ok?: unknown; code?: unknown; message?: unknown; error?: { message?: unknown } };
  if (o.ok !== false && !o.error && typeof o.id === 'string' && PAYPAL_ID.test(o.id) && typeof o.status === 'string') {
    return { kind: 'refund', refundId: o.id, status: o.status.slice(0, 40).toUpperCase() };
  }
  const message = String(o.message ?? o.error?.message ?? 'refund failed').slice(0, 200);
  if (/CAPTURE_FULLY_REFUNDED|fully refunded/i.test(message)) return { kind: 'already_refunded' };
  const httpStatus = typeof o.status === 'number' ? o.status : null;
  if (o.code === 'PAYPAL_API_NO_RESPONSE' || (httpStatus !== null && httpStatus >= 500)) return { kind: 'unknown', message };
  return { kind: 'error', message };
}

/** `({ captureId, requestId }) => outcome`: one full refund through the Toolkit's create_refund. */
export function toolkitRefunder(opts: { clientId: string; clientSecret: string; makeToolkit?: (requestId: string) => ToolkitLike }) {
  const make = opts.makeToolkit ?? ((requestId: string) => new PayPalAgentToolkit({ clientId: opts.clientId, clientSecret: opts.clientSecret, configuration: refundToolkitConfiguration(requestId) }) as unknown as ToolkitLike);
  return async (input: { captureId: string; requestId: string }): Promise<ToolkitRefundOutcome> => {
    // The Toolkit's own capture ID check, applied before anything is built.
    if (!/^[A-Za-z0-9_-]{15,32}$/.test(input.captureId)) return { kind: 'error', message: 'invalid capture ID' };
    const createRefund = make(input.requestId).getTools().create_refund?.execute as Execute<{ capture_id: string }> | undefined;
    if (!createRefund) throw new Error('Agent Toolkit create_refund is not available');
    return refundOutcome(await createRefund({ capture_id: input.captureId }, { toolCallId: `refund-${input.requestId}`, messages: [] }));
  };
}
