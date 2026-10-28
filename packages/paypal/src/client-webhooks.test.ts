import { describe, expect, it, vi } from 'vitest';
import { PayPalApiError, PayPalClient } from './client';
import { orderBody, toMoney } from './orders';
import { fakePayPal, seededStore, USER } from './test-helpers';
import { handleWebhook } from './webhooks';

describe('PayPalClient', () => {
  function tokenServer(expiresIn = 32400) {
    let n = 0;
    const f = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: `tok_${++n}`, expires_in: expiresIn }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    return { f, tokens: () => n };
  }

  it('caches the token and refreshes it 5 minutes before expiry', async () => {
    let now = 0;
    const { f, tokens } = tokenServer(3600);
    const c = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: f as unknown as typeof fetch, now: () => now });
    expect(await c.accessToken()).toBe('tok_1');
    now = 54 * 60_000; // 54 min: still fresh
    expect(await c.accessToken()).toBe('tok_1');
    now = 55 * 60_000 + 1; // inside the 5-minute margin
    expect(await c.accessToken()).toBe('tok_2');
    expect(tokens()).toBe(2);
  });

  it('concurrent callers share one token request', async () => {
    const { f, tokens } = tokenServer();
    const c = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: f as unknown as typeof fetch });
    await Promise.all([c.accessToken(), c.accessToken(), c.accessToken()]);
    expect(tokens()).toBe(1);
  });

  it('every POST carries PayPal-Request-Id and Prefer: return=representation; POST without one is refused', async () => {
    const { f } = tokenServer();
    const c = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: f as unknown as typeof fetch });
    await c.request('POST', '/v2/checkout/orders', { body: {}, requestId: 'vc-abc' });
    const headers = (f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers).toMatchObject({ 'paypal-request-id': 'vc-abc', prefer: 'return=representation', authorization: 'Bearer tok_1' });
    await expect(c.request('POST', '/v2/checkout/orders', { body: {} })).rejects.toThrow('PayPal-Request-Id');
  });

  it('a 401 refreshes the token once and replays with the same request id', async () => {
    let calls = 0;
    let tokens = 0;
    const f = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: `tok_${++tokens}`, expires_in: 32400 }), { status: 200 });
      return ++calls === 1 ? new Response('{}', { status: 401 }) : new Response('{"id":"X"}', { status: 200 });
    });
    const c = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: f as unknown as typeof fetch });
    expect(await c.request('POST', '/x', { body: {}, requestId: 'same' })).toEqual({ id: 'X' });
    expect(tokens).toBe(2);
  });

  it('is sandbox-only', () => {
    expect(() => new PayPalClient({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://api-m.paypal.com' })).toThrow('sandbox-only');
  });

  it('parses PayPal errors (issue + debug_id), without leaking credentials', async () => {
    const f = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/oauth2/token')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 32400 }), { status: 200 })
        : new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', message: 'nope', debug_id: 'dbg1', details: [{ issue: 'REAUTHORIZATION_TOO_SOON' }] }), { status: 422 }),
    );
    const c = new PayPalClient({ clientId: 'id', clientSecret: 'super-secret', fetch: f as unknown as typeof fetch });
    const err = await c.request('POST', '/x', { body: {}, requestId: 'r' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 422, issue: 'REAUTHORIZATION_TOO_SOON', debugId: 'dbg1' });
    expect(String((err as Error).message)).not.toContain('super-secret');
  });
});

describe('order bodies', () => {
  it('never include a payee; vaulted charges have no approval URLs', () => {
    const base = { amount: toMoney(59, 'USD'), storeSlug: 'velbrook-supply', storeName: 'Velbrook Supply' };
    expect(JSON.stringify(orderBody({ ...base, intent: 'AUTHORIZE', returnUrl: 'https://a.test/r', cancelUrl: 'https://a.test/c' }))).not.toContain('payee');
    expect(orderBody({ ...base, intent: 'CAPTURE', vaultId: 'V1' }).payment_source).toEqual({ paypal: { vault_id: 'V1' } });
    expect(() => orderBody({ ...base, intent: 'AUTHORIZE' })).toThrow('returnUrl');
    expect(() => orderBody({ ...base, storeSlug: 'Bad Slug!', intent: 'CAPTURE', vaultId: 'V1' })).toThrow('slug');
    expect(() => toMoney(-1, 'USD')).toThrow();
    expect(toMoney('59', 'USD')).toEqual({ value: '59.00', currency: 'USD' });
  });
});

describe('webhooks', () => {
  const SIG = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-10-28T12:00:00Z',
  };

  async function withPayment(verifyStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS') {
    const pp = fakePayPal({ verifyStatus });
    const { store, candidate } = seededStore();
    const payment = await store.insertPayment({
      userId: USER,
      sessionId: candidate.sessionId,
      candidateId: candidate.id,
      scanId: 'scan-hold',
      paypalOrderId: 'ORDER9',
      authorizationId: null,
      captureId: null,
      storeSlug: 'velbrook-supply',
      amount: '59.00',
      currency: 'USD',
      status: 'created',
      mode: 'approve',
      overrideUsed: false,
    });
    const deps = { paypal: pp.client, webhookId: 'WH-1', store };
    const send = (event: object, headers: Record<string, string> = SIG) => handleWebhook({ headers, rawBody: JSON.stringify(event) }, deps);
    return { pp, store, payment, send };
  }

  const authCreated = { id: 'WH-EVT-1', event_type: 'PAYMENT.AUTHORIZATION.CREATED', resource: { id: 'AUTH-9', status: 'CREATED', supplementary_data: { related_ids: { order_id: 'ORDER9' } } } };

  it('verifies the signature with PayPal and updates the payment', async () => {
    const { pp, store, payment, send } = await withPayment();
    expect(await send(authCreated)).toMatchObject({ httpStatus: 200, outcome: 'processed', paymentId: payment.id });
    const verify = pp.callsTo(/verify-webhook-signature/)[0]!.body as Record<string, unknown>;
    expect(verify).toMatchObject({ webhook_id: 'WH-1', transmission_id: 'tx-1', webhook_event: authCreated });
    expect(store.payments.get(payment.id)).toMatchObject({ status: 'authorized', authorizationId: 'AUTH-9' });
    expect(store.webhookEvents.get('WH-EVT-1')).toMatchObject({ signatureVerified: true, processed: true });
  });

  it('bad signature → 401, nothing stored or changed', async () => {
    const { store, payment, send } = await withPayment('FAILURE');
    expect(await send(authCreated)).toMatchObject({ httpStatus: 401, outcome: 'rejected' });
    expect(store.webhookEvents.size).toBe(0);
    expect(store.payments.get(payment.id)?.status).toBe('created');
  });

  it('missing signature headers → 401 without calling PayPal', async () => {
    const { pp, send } = await withPayment();
    expect(await send(authCreated, {})).toMatchObject({ httpStatus: 401 });
    expect(pp.callsTo(/verify-webhook-signature/)).toHaveLength(0);
  });

  it('duplicate event id → ignored (idempotent on paypal_event_id)', async () => {
    const { store, send } = await withPayment();
    await send(authCreated);
    const audits = store.audit.length;
    expect(await send(authCreated)).toEqual({ httpStatus: 200, outcome: 'duplicate' });
    expect(store.audit.length).toBe(audits);
  });

  it('an event stored but not processed (crash mid-way) is processed on retry', async () => {
    const { store, payment, send } = await withPayment();
    await store.recordWebhookEvent({ paypalEventId: 'WH-EVT-1', eventType: authCreated.event_type, signatureVerified: true, payload: authCreated });
    expect(await send(authCreated)).toMatchObject({ outcome: 'processed' });
    expect(store.payments.get(payment.id)?.status).toBe('authorized');
  });

  it('a late event never moves a payment backwards', async () => {
    const { store, payment, send } = await withPayment();
    await store.updatePayment(payment.id, { status: 'captured', captureId: 'CAP-1' });
    await send(authCreated);
    expect(store.payments.get(payment.id)?.status).toBe('captured');
  });

  it('CHECKOUT.ORDER.APPROVED → approved + asks the route to run completeApproval (webhooks never capture)', async () => {
    const { pp, payment, send } = await withPayment();
    const r = await send({ id: 'WH-EVT-2', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER9', status: 'APPROVED' } });
    expect(r).toMatchObject({ outcome: 'processed', followUp: { action: 'complete_approval', paymentId: payment.id, userId: USER } });
    expect(pp.callsTo(/capture$/)).toHaveLength(0);
  });

  it('capture completed / voided / vault token events update the right rows', async () => {
    const { store, payment, send } = await withPayment();
    await send({ id: 'E3', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-9', supplementary_data: { related_ids: { order_id: 'ORDER9' } } } });
    expect(store.payments.get(payment.id)).toMatchObject({ status: 'captured', captureId: 'CAP-9' });
    await send({ id: 'E4', event_type: 'VAULT.PAYMENT-TOKEN.CREATED', resource: { id: 'VAULT-9', metadata: { order_id: 'ORDER9' } } });
    expect(store.vaultTokens).toEqual([{ userId: USER, paypalVaultTokenId: 'VAULT-9', status: 'VAULTED' }]);
    expect(await send({ id: 'E5', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: 'AUTH-0', supplementary_data: { related_ids: { order_id: 'UNKNOWN' } } } })).toEqual({ httpStatus: 200, outcome: 'ignored' });
  });

  it('malformed body → 400', async () => {
    const { store } = await withPayment();
    const pp = fakePayPal();
    expect(await handleWebhook({ headers: SIG, rawBody: 'not json' }, { paypal: pp.client, webhookId: 'WH-1', store })).toMatchObject({ httpStatus: 400 });
  });
});
