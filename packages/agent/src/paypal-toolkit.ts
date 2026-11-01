import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { GetOrderOutput } from './tools';

/**
 * PayPal Agent Toolkit, read-only (spec 5.7, decided Oct 31): ONLY `get_order` is enabled. Its `create_order` is
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
  getTools(): Record<string, { execute?: (args: { id: string }, options: { toolCallId: string; messages: [] }) => PromiseLike<unknown> }>;
}

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
    const getOrder = cached.toolkit.getTools().get_order?.execute;
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
export function agentOrderStatus(paymentId: string, view: OrderStatusView | null): GetOrderOutput {
  if (!view) return { paymentId, status: 'unavailable' };
  const r = GetOrderOutput.safeParse({ paymentId, status: 'ok', orderStatus: view.status, intent: view.intent, amount: view.amount, authorizationStatus: view.authorizationStatus, captureStatus: view.captureStatus });
  return r.success ? r.data : { paymentId, status: 'unavailable' };
}
