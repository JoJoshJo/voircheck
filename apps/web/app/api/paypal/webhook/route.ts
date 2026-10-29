import { handleWebhook } from '@voircheck/paypal';
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
export async function POST(req: Request) {
  // Unset ID: unsigned requests still get 401 (no headers), signed ones fail PayPal verification (401) and retry later.
  const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? '';
  if (!webhookId) console.warn('PAYPAL_WEBHOOK_ID is not set; webhooks will be rejected');

  const rawBody = await req.text();
  if (rawBody.length > 200_000) return Response.json({ error: 'too large' }, { status: 413 });
  const headers = Object.fromEntries(req.headers.entries());

  try {
    const { paypal, store, gate } = getPayPal();
    const out = await handleWebhook({ headers, rawBody }, { paypal, webhookId, store });
    if (out.outcome === 'processed' && out.followUp?.action === 'complete_approval') {
      const { paymentId, userId } = out.followUp;
      await gate.completeApproval(paymentId, userId, 'webhook');
      // Receipt + email even if the buyer closed the tab (the browser path does the same; the email is sent once).
      const profile = await getProfile(userId);
      const origin = process.env.APP_URL ?? new URL(req.url).origin;
      await upsertPaymentReceipt(paymentId, profile && isLang(profile.language) ? profile.language : 'en', origin).catch(() => null);
    }
    return Response.json({ outcome: out.outcome }, { status: out.httpStatus });
  } catch (err) {
    // 5xx makes PayPal retry; a stored-but-unprocessed event is processed again on retry.
    console.error('paypal webhook failed:', err instanceof Error ? err.message : 'unknown error');
    return Response.json({ error: 'temporary failure' }, { status: 500 });
  }
}
