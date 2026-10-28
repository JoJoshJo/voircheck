import type { PayPalClient } from './client';
import { requestIdFor } from './gate';
import type { GateStore, PaymentRow, PaymentStatus } from './store';

/**
 * PayPal webhooks (spec 5.7 / 5.17 #4): verify every signature with PayPal, record each event once keyed on
 * paypal_event_id, then update the payments row. Unverified events are rejected and never stored, so a forged
 * event id can't block the genuine one later.
 */

const SIG_HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'] as const;

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
    metadata?: { order_id?: string };
  };
}

export async function verifyWebhookSignature(paypal: PayPalClient, webhookId: string, headers: Record<string, string | undefined>, event: unknown): Promise<boolean> {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (SIG_HEADERS.some((k) => !h[k])) return false;
  const res = await paypal.request<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
    body: {
      auth_algo: h['paypal-auth-algo'],
      cert_url: h['paypal-cert-url'],
      transmission_id: h['paypal-transmission-id'],
      transmission_sig: h['paypal-transmission-sig'],
      transmission_time: h['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    },
    requestId: requestIdFor('verify-webhook', h['paypal-transmission-id']!),
  });
  return res.verification_status === 'SUCCESS';
}

/** Status only moves forward; a late "authorization created" can't undo a capture or void. */
const RANK: Record<PaymentStatus, number> = { created: 0, approved: 1, authorized: 2, capture_pending: 3, captured: 4, voided: 4, capture_denied: 4, failed: 4 };
const canMove = (from: PaymentStatus, to: PaymentStatus) => RANK[to] > RANK[from] || (from === 'capture_pending' && RANK[to] === 4);

export type WebhookOutcome =
  | { httpStatus: 401; outcome: 'rejected'; reason: string }
  | { httpStatus: 400; outcome: 'invalid'; reason: string }
  | { httpStatus: 200; outcome: 'duplicate' | 'ignored' }
  | { httpStatus: 200; outcome: 'processed'; paymentId?: string; followUp?: { action: 'complete_approval'; paymentId: string; userId: string } };

export interface WebhookDeps {
  paypal: PayPalClient;
  webhookId: string;
  store: GateStore;
}

export async function handleWebhook(req: { headers: Record<string, string | undefined>; rawBody: string }, deps: WebhookDeps): Promise<WebhookOutcome> {
  let event: WebhookEvent;
  try {
    event = JSON.parse(req.rawBody) as WebhookEvent;
  } catch {
    return { httpStatus: 400, outcome: 'invalid', reason: 'body is not JSON' };
  }
  if (typeof event?.id !== 'string' || typeof event.event_type !== 'string') return { httpStatus: 400, outcome: 'invalid', reason: 'missing event id/type' };

  let verified = false;
  try {
    verified = await verifyWebhookSignature(deps.paypal, deps.webhookId, req.headers, event);
  } catch {
    verified = false;
  }
  if (!verified) return { httpStatus: 401, outcome: 'rejected', reason: 'signature verification failed' };

  const state = await deps.store.recordWebhookEvent({ paypalEventId: event.id, eventType: event.event_type, signatureVerified: true, payload: event });
  if (state === 'processed') return { httpStatus: 200, outcome: 'duplicate' };

  const result = await applyEvent(event, deps.store);
  await deps.store.markWebhookProcessed(event.id);
  return result;
}

async function applyEvent(event: WebhookEvent, store: GateStore): Promise<WebhookOutcome> {
  const r = event.resource ?? {};
  const relatedOrder = r.supplementary_data?.related_ids?.order_id;
  const find = (orderId: string | undefined) => (orderId ? store.getPaymentByOrderId(orderId) : Promise.resolve(null));

  const move = async (payment: PaymentRow | null, to: PaymentStatus, patch: { authorizationId?: string; captureId?: string } = {}): Promise<WebhookOutcome> => {
    if (!payment) return { httpStatus: 200, outcome: 'ignored' };
    if (canMove(payment.status, to)) await store.updatePayment(payment.id, { status: to, ...patch });
    await store.appendAudit({ userId: payment.userId, actor: 'webhook', action: `webhook.${event.event_type}`, entity: 'payment', entityId: payment.id, details: { eventId: event.id, from: payment.status, to, applied: canMove(payment.status, to) } });
    return { httpStatus: 200, outcome: 'processed', paymentId: payment.id };
  };

  switch (event.event_type) {
    case 'CHECKOUT.ORDER.APPROVED': {
      const payment = await find(r.id);
      const out = await move(payment, 'approved');
      // The route calls MoneyGate.completeApproval next; webhooks never capture by themselves.
      return payment && payment.mode === 'approve' && out.outcome === 'processed' ? { ...out, followUp: { action: 'complete_approval', paymentId: payment.id, userId: payment.userId } } : out;
    }
    case 'PAYMENT.AUTHORIZATION.CREATED':
      return move(await find(relatedOrder), 'authorized', r.id ? { authorizationId: r.id } : {});
    case 'PAYMENT.AUTHORIZATION.VOIDED':
      return move(await find(relatedOrder), 'voided');
    case 'PAYMENT.CAPTURE.COMPLETED':
      return move(await find(relatedOrder), 'captured', r.id ? { captureId: r.id } : {});
    case 'PAYMENT.CAPTURE.PENDING':
      return move(await find(relatedOrder), 'capture_pending', r.id ? { captureId: r.id } : {});
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED':
      return move(await find(relatedOrder), 'capture_denied');
    case 'VAULT.PAYMENT-TOKEN.CREATED': {
      const payment = await find(r.metadata?.order_id);
      if (!payment || !r.id) return { httpStatus: 200, outcome: 'ignored' };
      await store.saveVaultToken(payment.userId, r.id, 'VAULTED'); // token ID only
      await store.appendAudit({ userId: payment.userId, actor: 'webhook', action: 'webhook.VAULT.PAYMENT-TOKEN.CREATED', entity: 'vault_token', entityId: null, details: { eventId: event.id, paymentId: payment.id } });
      return { httpStatus: 200, outcome: 'processed', paymentId: payment.id };
    }
    default:
      return { httpStatus: 200, outcome: 'ignored' };
  }
}
