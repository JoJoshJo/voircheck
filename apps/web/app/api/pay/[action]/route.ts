import { PayPalApiError } from '@voircheck/paypal';
import { headers } from 'next/headers';
import { z } from 'zod';
import { getPaymentView } from '../../../../lib/payment-view';
import { getPayPal } from '../../../../lib/paypal';
import { upsertPaymentReceipt } from '../../../../lib/receipts';
import { getCurrentUser, getProfile } from '../../../../lib/user';
import { isLang } from '../../../../lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Checkout API (spec 5.7). The browser sends IDs only; amount, currency and store always come from our rows,
 * and every money decision is made by MoneyGate. Responses never include PayPal order/authorization/capture IDs,
 * except the order ID the PayPal SDK itself needs to open the approval popup.
 */
const Id = z.string().uuid();
const Key = z.string().min(8).max(100);
const bodies = {
  'client-token': z.object({}),
  start: z.object({ candidateId: Id, scanId: Id, idempotencyKey: Key, override: z.boolean().default(false) }),
  approve: z.object({ paymentId: Id }),
  status: z.object({ paymentId: Id }),
  capture: z.object({ paymentId: Id, override: z.boolean().default(false) }),
  void: z.object({ paymentId: Id }),
  reauthorize: z.object({ paymentId: Id }),
  cancel: z.object({ paymentId: Id }),
  autopay: z.object({ candidateId: Id, scanId: Id, idempotencyKey: Key }),
  'wallet-setup': z.object({}),
  'wallet-confirm': z.object({ setupTokenId: z.string().min(5).max(100) }),
} as const;
type Action = keyof typeof bodies;

async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!(action in bodies)) return json({ error: 'not_found' }, 404);
  const user = await getCurrentUser();
  const profile = user ? await getProfile(user.id) : null;
  if (!user || !profile) return json({ error: 'auth' }, 401);
  const parsed = bodies[action as Action].safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const lang = isLang(profile.language) ? profile.language : 'en';
  const { gate, paypal } = getPayPal();
  const userId = user.id;
  const view = async (paymentId: string, receipt = true) => {
    if (receipt) await upsertPaymentReceipt(paymentId, lang);
    return getPaymentView(paymentId, userId);
  };

  try {
    // Already validated against bodies[action] above.
    const b = parsed.data as unknown;
    switch (action as Action) {
      case 'client-token': {
        // PayPal scopes the token to bare hostnames and refuses localhost, so local dev gets an unscoped sandbox token.
        const host = new URL(await appOrigin()).hostname;
        const local = host === 'localhost' || /^[\d.]+$/.test(host) || host.endsWith('.localhost');
        const { token } = await paypal.browserClientToken(local ? [] : [host]);
        return json({ clientToken: token });
      }
      case 'start': {
        const { candidateId, scanId, idempotencyKey, override } = b as z.infer<(typeof bodies)['start']>;
        const origin = await appOrigin();
        const r = await gate.startApprovePurchase({ userId, candidateId, scanId, idempotencyKey, override, returnUrl: `${origin}/app`, cancelUrl: `${origin}/app` });
        if (!r.ok) return json({ error: 'refused', reason: r.reason }, 409);
        return json({ paymentId: r.payment.id, orderId: r.payment.paypalOrderId });
      }
      case 'approve': {
        const r = await gate.completeApproval((b as { paymentId: string }).paymentId, userId, 'user');
        if (!r.ok) return json({ error: 'not_approved', reason: r.reason, payment: r.payment ? await view(r.payment.id, false) : null }, 409);
        return json({ payment: await view(r.payment.id) });
      }
      case 'status': {
        const paymentId = (b as { paymentId: string }).paymentId;
        const current = await getPaymentView(paymentId, userId);
        if (!current) return json({ error: 'not_found' }, 404);
        if (current.status === 'created') {
          // Approval fallback: the SDK callback may not fire (popup closed early, sandbox second click). Ask PayPal.
          const r = await gate.completeApproval(paymentId, userId, 'user');
          if (r.ok) return json({ payment: await view(paymentId) });
          return json({ payment: current, approved: false });
        }
        return json({ payment: current });
      }
      case 'capture': {
        const { paymentId, override } = b as z.infer<(typeof bodies)['capture']>;
        const r = await gate.userCapture({ userId, paymentId, override });
        if (!r.ok) return json({ error: 'refused', reason: r.reason }, 409);
        return json({ payment: await view(paymentId) });
      }
      case 'void': {
        const paymentId = (b as { paymentId: string }).paymentId;
        const r = await gate.userVoid({ userId, paymentId });
        if (!r.ok) return json({ error: 'refused', reason: r.reason }, 409);
        return json({ payment: await view(paymentId) });
      }
      case 'reauthorize': {
        const paymentId = (b as { paymentId: string }).paymentId;
        const r = await gate.reauthorize({ userId, paymentId });
        if (!r.ok) return json({ error: 'refused', reason: r.reason }, 409);
        return json({ payment: await view(paymentId) });
      }
      case 'cancel': {
        const paymentId = (b as { paymentId: string }).paymentId;
        const r = await gate.cancelPurchase({ userId, paymentId });
        if (!r.ok && r.reason === 'already approved') {
          // The approval landed after all: finish it instead of cancelling.
          const done = await gate.completeApproval(paymentId, userId, 'user');
          return json({ payment: await view(paymentId, done.ok), approvedAfterAll: true });
        }
        if (!r.ok) return json({ error: 'refused', reason: r.reason }, 409);
        return json({ payment: await view(paymentId) });
      }
      case 'autopay': {
        const { candidateId, scanId, idempotencyKey } = b as z.infer<(typeof bodies)['autopay']>;
        const r = await gate.autoPay({ userId, candidateId, scanId, idempotencyKey });
        if (!r.ok) return json({ autopaid: false, reason: r.reason });
        return json({ autopaid: true, payment: await view(r.payment.id) });
      }
      case 'wallet-setup': {
        const origin = await appOrigin();
        const { setupTokenId } = await gate.startWalletSetup({ userId, returnUrl: `${origin}/app/settings`, cancelUrl: `${origin}/app/settings` });
        return json({ setupToken: setupTokenId });
      }
      case 'wallet-confirm': {
        const r = await gate.confirmWalletSetup({ userId, setupTokenId: (b as { setupTokenId: string }).setupTokenId });
        return r.ok ? json({ saved: true }) : json({ error: 'refused', reason: r.reason }, 409);
      }
    }
  } catch (err) {
    console.error(`pay/${action} failed:`, err instanceof PayPalApiError ? err.message : err instanceof Error ? err.message : 'unknown');
    return json({ error: err instanceof PayPalApiError ? 'paypal' : 'failed' }, 502);
  }
  return json({ error: 'not_found' }, 404);
}

