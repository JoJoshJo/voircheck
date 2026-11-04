import { LAB_ATTACKER_EMAIL, LAB_ATTACKS, LAB_GIFT_CARD_EMAIL, labAttackStrings } from '@voircheck/shared/lab';
import { describe, expect, it } from 'vitest';
import { MoneyGate } from './gate';
import { fakePayPal, NOW, seededStore, USER } from './test-helpers';

const urls = { returnUrl: 'https://voircheck.test/return', cancelUrl: 'https://voircheck.test/cancel' };

/**
 * Attack lab (task 3): even when an attack's words are in the store's own row (the merchant-supplied product title),
 * MoneyGate's PayPal order has no payee and the amount is the listed price, so nothing an attack says can move money
 * elsewhere, add a gift card or change the price.
 */
describe.each(LAB_ATTACKS.map((a) => [a.id, a] as const))('attack lab: %s cannot change who is paid or how much', (_id, attack) => {
  it('the PayPal order goes to VoirCheck’s own merchant, for the listed $49.00, with no planted words', async () => {
    const pp = fakePayPal();
    const { store, candidate } = seededStore();
    store.candidates.set(candidate.id, { ...candidate, storeName: 'Quillmere Audio', productTitle: attack.offerTitle, price: '49.00' });
    const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
    const r = await gate.agentStartPurchase({ userId: USER, candidateId: candidate.id, scanId: 'scan-safe', idempotencyKey: `lab-${attack.id}`, ...urls, payee: LAB_ATTACKER_EMAIL, amount: '149.00', giftCard: LAB_GIFT_CARD_EMAIL } as never);
    expect(r.ok).toBe(true);
    const [order] = pp.callsTo(/POST \/v2\/checkout\/orders$/);
    const body = order!.body as { purchase_units: Array<Record<string, unknown>> };
    expect(body.purchase_units).toHaveLength(1);
    expect(body.purchase_units[0]).not.toHaveProperty('payee');
    expect(body.purchase_units[0]).not.toHaveProperty('items');
    expect(body.purchase_units[0]!.amount).toEqual({ currency_code: 'USD', value: '49.00' });
    const json = JSON.stringify(body);
    expect(json).not.toContain(LAB_ATTACKER_EMAIL);
    expect(json).not.toContain(LAB_GIFT_CARD_EMAIL);
    // Prepared only: nothing captured, voided or charged.
    expect(pp.callsTo(/capture|void|authorize/)).toHaveLength(0);
    for (const w of labAttackStrings(attack).filter((w) => w.length > 40)) expect(json).not.toContain(w.slice(0, 127));
  });
});
