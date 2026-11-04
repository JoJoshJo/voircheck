import { handleWebhook, rejectedWebhookLog } from '@voircheck/paypal';
import { publicOrigin } from '../../../../lib/app-origin';
import { getProfile } from '../../../../lib/user';
import { isLang } from '../../../../lib/i18n';
import { getPayPal } from '../../../../lib/paypal';
import { upsertPaymentReceipt } from '../../../../lib/receipts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PayPal webhooks (spec 5.7 / 5.17 #4). Every event's signature is verified with PayPal before anything is stored;
 * events are idempotent on paypal_event_id. Webhooks never capture by themselves: an approved order goes through
 * the money gate like any other approval.
 */
/** PayPal events are a few KB; anything bigger is refused before it is read into memory. */
const MAX_WEBHOOK_BYTES = 200_000;

/**
 * The body as text, or null when it is larger than `max` bytes: refused from Content-Length before reading, and,
 * without one (chunked), while reading, so an oversized body is never held in memory whole.
 */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(req: Request) {
  // Unset ID: unsigned requests still get 401 (no headers), signed ones fail PayPal verification (401) and retry later.
  const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? '';
  if (!webhookId) console.warn('PAYPAL_WEBHOOK_ID is not set; webhooks will be rejected');

  const rawBody = await readCapped(req, MAX_WEBHOOK_BYTES);
  if (rawBody === null) return Response.json({ error: 'too large' }, { status: 413 });
  const headers = Object.fromEntries(req.headers.entries());

  try {
    const { paypal, store, gate } = getPayPal();
    const out = await handleWebhook({ headers, rawBody }, { paypal, webhookId, store });
    if (out.httpStatus === 401 || out.httpStatus === 400) console.warn(rejectedWebhookLog(out, rawBody));
    if (out.outcome === 'processed' && out.followUp?.action === 'complete_approval') {
      const { paymentId, userId } = out.followUp;
      await gate.completeApproval(paymentId, userId, 'webhook');
      // Receipt + email even if the buyer closed the tab (the browser path does the same; the email is sent once).
      const profile = await getProfile(userId);
      const origin = publicOrigin(req.headers);
      await upsertPaymentReceipt(paymentId, profile && isLang(profile.language) ? profile.language : 'en', origin).catch(() => null);
    } else if (out.outcome === 'processed' && out.followUp?.action === 'refresh_receipt') {
      // A refund changed the payment: the receipt shows it (no second email; it is sent once per receipt).
      const { paymentId, userId } = out.followUp;
      const profile = await getProfile(userId);
      await upsertPaymentReceipt(paymentId, profile && isLang(profile.language) ? profile.language : 'en', publicOrigin(req.headers)).catch(() => null);
    }
    return Response.json({ outcome: out.outcome }, { status: out.httpStatus });
  } catch (err) {
    // 5xx makes PayPal retry; a stored-but-unprocessed event is processed again on retry.
    console.error('paypal webhook failed:', err instanceof Error ? err.message : 'unknown error');
    return Response.json({ error: 'temporary failure' }, { status: 500 });
  }
}
