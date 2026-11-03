import type { PayPalClient } from './client';
import { requestIdFor } from './gate';
import type { GateStore, PaymentRow, PaymentStatus } from './store';
import { redactWebhookPayload } from './webhook-redact';
import { z } from 'zod';

/**
 * PayPal webhooks (spec 5.7 / 5.17 #4): verify every signature with PayPal, record each event once keyed on
 * paypal_event_id, then update the payments row. Unverified events are rejected and never stored, so a forged
 * event id can't block the genuine one later.
 */

const SIG_HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'] as const;

/** The fields we read. Loose: PayPal's signature check needs the event exactly as sent, unknown fields included. */
const Id = z.string().min(1).max(200);
export const WebhookEvent = z.looseObject({
  id: Id,
  event_type: Id,
  resource: z
    .looseObject({
      id: Id.optional(),
      status: z.string().max(100).optional(),
      supplementary_data: z.looseObject({ related_ids: z.looseObject({ order_id: Id.optional(), authorization_id: Id.optional(), capture_id: Id.optional() }).optional() }).optional(),
      metadata: z.looseObject({ order_id: Id.optional() }).optional(),
      links: z.array(z.looseObject({ rel: z.string().max(50).optional(), href: z.string().max(2048).optional() })).max(20).optional(),
    })
    .optional(),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;

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

/** Status only moves forward; a late "authorization created" can't undo a capture or void. Refunds follow a capture only. */
const RANK: Record<PaymentStatus, number> = { created: 0, approved: 1, authorized: 2, capture_pending: 3, captured: 4, voided: 4, capture_denied: 4, failed: 4, cancelled: 4, replaced: 4, refund_pending: 5, refunded: 6 };
const REFUNDABLE_FROM: PaymentStatus[] = ['capture_pending', 'captured', 'refund_pending'];
const canMove = (from: PaymentStatus, to: PaymentStatus) =>
  to === 'refund_pending' || to === 'refunded' ? REFUNDABLE_FROM.includes(from) && RANK[to] > RANK[from] : RANK[to] > RANK[from] || (from === 'capture_pending' && RANK[to] === 4);

/** A refund event's resource is the refund; its capture is in related_ids or the "up" link (…/captures/{id}). */
function refundedCaptureId(r: NonNullable<WebhookEvent['resource']>): string | undefined {
  const related = r.supplementary_data?.related_ids?.capture_id;
  if (related) return related;
  const up = r.links?.find((l) => l.rel === 'up' && l.href?.includes('/captures/'))?.href;
  return up?.match(/\/captures\/([A-Za-z0-9_-]{1,64})/)?.[1];
}

export type WebhookOutcome =
  | { httpStatus: 401; outcome: 'rejected'; reason: string }
  | { httpStatus: 400; outcome: 'invalid'; reason: string }
  | { httpStatus: 200; outcome: 'duplicate' | 'ignored' }
  | { httpStatus: 200; outcome: 'processed'; paymentId?: string; followUp?: { action: 'complete_approval' | 'refresh_receipt'; paymentId: string; userId: string } };

/**
 * One log line for a webhook we turn away (401 bad signature, 400 unreadable), so a silent outage like Nov 1–3 shows
 * up in the server logs. Event id and type only (cleaned, capped): never the body, headers or payer details.
 */
export function rejectedWebhookLog(out: { httpStatus: number; reason: string }, rawBody: string): string {
  let id = '?';
  let type = '?';
  try {
    const e = JSON.parse(rawBody) as { id?: unknown; event_type?: unknown };
    const clean = (v: unknown) => (typeof v === 'string' && v ? v.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80) || '?' : '?');
    id = clean(e.id);
    type = clean(e.event_type);
  } catch {
    // not JSON: id and type stay unknown
  }
  return `paypal webhook rejected (${out.httpStatus}): ${out.reason}; event ${id} ${type}`;
}

export interface WebhookDeps {
  paypal: PayPalClient;
  webhookId: string;
  store: GateStore;
}

export async function handleWebhook(req: { headers: Record<string, string | undefined>; rawBody: string }, deps: WebhookDeps): Promise<WebhookOutcome> {
  let json: unknown;
  try {
    json = JSON.parse(req.rawBody);
  } catch {
    return { httpStatus: 400, outcome: 'invalid', reason: 'body is not JSON' };
  }
  const parsed = WebhookEvent.safeParse(json);
  if (!parsed.success) return { httpStatus: 400, outcome: 'invalid', reason: 'missing event id/type' };
  const event = parsed.data;

  // PayPal checks the event as sent: verify the JSON.parse result, not zod's output (zod reorders keys → FAILURE).
  let verified = false;
  try {
    verified = await verifyWebhookSignature(deps.paypal, deps.webhookId, req.headers, json);
  } catch {
    verified = false;
  }
  if (!verified) return { httpStatus: 401, outcome: 'rejected', reason: 'signature verification failed' };

  // Stored redacted (payment status details only, no payer PII); verification above used the original event.
  const state = await deps.store.recordWebhookEvent({ paypalEventId: event.id, eventType: event.event_type, signatureVerified: true, payload: redactWebhookPayload(event) });
  if (state === 'processed') return { httpStatus: 200, outcome: 'duplicate' };

  const result = await applyEvent(event, deps.store);
  await deps.store.markWebhookProcessed(event.id);
  return result;
}

async function applyEvent(event: WebhookEvent, store: GateStore): Promise<WebhookOutcome> {
  const r = event.resource ?? {};
  const relatedOrder = r.supplementary_data?.related_ids?.order_id;
  const find = (orderId: string | undefined) => (orderId ? store.getPaymentByOrderId(orderId) : Promise.resolve(null));

  const move = async (payment: PaymentRow | null, to: PaymentStatus, patch: { authorizationId?: string; captureId?: string; refundId?: string } = {}): Promise<WebhookOutcome> => {
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
    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED': {
      const captureId = refundedCaptureId(r);
      const payment = captureId ? await store.getPaymentByCaptureId(captureId) : await find(relatedOrder);
      // REVERSED = PayPal returned the money to the buyer itself (a dispute, say): shown as refunded too.
      const to: PaymentStatus = event.event_type === 'PAYMENT.CAPTURE.REFUNDED' && r.status === 'PENDING' ? 'refund_pending' : 'refunded';
      const out = await move(payment, to, r.id ? { refundId: r.id } : {});
      // The route refreshes the Trust Receipt so it shows the refund.
      return payment && out.outcome === 'processed' ? { ...out, followUp: { action: 'refresh_receipt', paymentId: payment.id, userId: payment.userId } } : out;
    }
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
