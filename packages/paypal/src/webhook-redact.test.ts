import { describe, expect, it } from 'vitest';
import { fakePayPal, seededStore, USER } from './test-helpers';
import { piiKeysPresent, redactWebhookPayload } from './webhook-redact';
import { handleWebhook } from './webhooks';

// Shapes taken from real sandbox events (values replaced).
const orderApproved = {
  id: 'WH-1',
  event_type: 'CHECKOUT.ORDER.APPROVED',
  resource_type: 'checkout-order',
  create_time: '2026-10-29T15:00:00Z',
  summary: 'An order has been approved by buyer',
  resource: {
    id: 'ORDER9',
    status: 'APPROVED',
    intent: 'AUTHORIZE',
    create_time: '2026-10-29T14:59:00Z',
    payer: { name: { given_name: 'Ama', surname: 'Buyer' }, email_address: 'buyer@example.com', payer_id: 'PAYERID', address: { country_code: 'US' }, phone: { phone_number: { national_number: '5550100' } } },
    payment_source: { paypal: { email_address: 'buyer@example.com', account_id: 'ACC', name: { given_name: 'Ama' }, address: { country_code: 'US' } } },
    purchase_units: [
      {
        reference_id: 'default',
        custom_id: 'velbrook-supply',
        amount: { currency_code: 'USD', value: '59.00' },
        payee: { email_address: 'merchant@example.com', merchant_id: 'M1' },
        shipping: { name: { full_name: 'Ama Buyer' }, address: { address_line_1: '1 Main St' } },
        payments: { authorizations: [{ id: 'AUTH9', status: 'CREATED', amount: { currency_code: 'USD', value: '59.00' }, create_time: 't' }] },
      },
    ],
    links: [{ href: 'https://api.sandbox.paypal.com/v2/checkout/orders/ORDER9', rel: 'self' }],
  },
};

const captureCompleted = {
  id: 'WH-2',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: 'CAP9', status: 'COMPLETED', amount: { currency_code: 'USD', value: '59.00' }, custom_id: 'velbrook-supply', final_capture: true, supplementary_data: { related_ids: { order_id: 'ORDER9', authorization_id: 'AUTH9' } }, payee: { email_address: 'merchant@example.com' } },
};

const vaultCreated = {
  id: 'WH-3',
  event_type: 'VAULT.PAYMENT-TOKEN.CREATED',
  resource: { id: 'VAULT9', metadata: { order_id: 'ORDER9' }, customer: { id: 'CUST' }, payment_source: { paypal: { email_address: 'buyer@example.com', name: { given_name: 'Ama' } } } },
};

describe('webhook payload redaction', () => {
  it('keeps only payment status details', () => {
    expect(redactWebhookPayload(orderApproved)).toEqual({
      id: 'WH-1',
      event_type: 'CHECKOUT.ORDER.APPROVED',
      resource_type: 'checkout-order',
      create_time: '2026-10-29T15:00:00Z',
      resource: {
        id: 'ORDER9',
        status: 'APPROVED',
        intent: 'AUTHORIZE',
        create_time: '2026-10-29T14:59:00Z',
        purchase_units: [
          {
            reference_id: 'default',
            custom_id: 'velbrook-supply',
            amount: { currency_code: 'USD', value: '59.00' },
            payments: { authorizations: [{ id: 'AUTH9', status: 'CREATED', create_time: 't', amount: { currency_code: 'USD', value: '59.00' } }] },
          },
        ],
      },
    });
  });

  it.each([orderApproved, captureCompleted, vaultCreated])('drops payer, payment_source, shipping, customer and emails ($event_type)', (event) => {
    const redacted = redactWebhookPayload(event);
    expect(piiKeysPresent(redacted).size).toBe(0);
    const json = JSON.stringify(redacted);
    for (const pii of ['buyer@example.com', 'merchant@example.com', 'Ama', '1 Main St', '5550100', 'PAYERID']) expect(json).not.toContain(pii);
  });

  it('keeps the ids the handlers need (related order id, vault order id, amounts, custom_id)', () => {
    expect(redactWebhookPayload(captureCompleted).resource).toEqual({
      id: 'CAP9',
      status: 'COMPLETED',
      custom_id: 'velbrook-supply',
      final_capture: true,
      amount: { currency_code: 'USD', value: '59.00' },
      supplementary_data: { related_ids: { order_id: 'ORDER9', authorization_id: 'AUTH9' } },
    });
    expect(redactWebhookPayload(vaultCreated).resource).toEqual({ id: 'VAULT9', metadata: { order_id: 'ORDER9' } });
  });

  it('handleWebhook verifies the original event but stores the redacted one; processing unchanged', async () => {
    const pp = fakePayPal();
    const { store, candidate } = seededStore();
    await store.insertPayment({ userId: USER, sessionId: candidate.sessionId, candidateId: candidate.id, scanId: 'scan-hold', paypalOrderId: 'ORDER9', authorizationId: null, captureId: null, storeSlug: 'velbrook-supply', amount: '59.00', currency: 'USD', status: 'created', mode: 'approve', overrideUsed: false });
    const headers = { 'paypal-auth-algo': 'a', 'paypal-cert-url': 'https://api.sandbox.paypal.com/c', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'now' };
    const out = await handleWebhook({ headers, rawBody: JSON.stringify(orderApproved) }, { paypal: pp.client, webhookId: 'WH', store });
    expect(out).toMatchObject({ httpStatus: 200, outcome: 'processed' });
    const verified = pp.callsTo(/verify-webhook-signature/)[0]!.body as { webhook_event: unknown };
    expect(verified.webhook_event).toEqual(orderApproved);
    const stored = store.webhookEvents.get('WH-1')!.payload;
    expect(stored).toEqual(redactWebhookPayload(orderApproved));
    expect(JSON.stringify(stored)).not.toContain('buyer@example.com');
    // Idempotency unchanged.
    expect(await handleWebhook({ headers, rawBody: JSON.stringify(orderApproved) }, { paypal: pp.client, webhookId: 'WH', store })).toEqual({ httpStatus: 200, outcome: 'duplicate' });
  });
});
