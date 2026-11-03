import { describe, expect, it } from 'vitest';
import { orderStatus, orderTotals, toOrderCards } from './orders-history';
import type { PaymentRecord } from './risk-log-map';

const NOW = Date.parse('2026-11-03T19:00:00Z');
const HOUR = 3_600_000;
const rec = (over: Partial<PaymentRecord>): PaymentRecord => ({
  paymentId: 'pay-1',
  sessionId: 'sess-chat',
  ref: 'VC-7K2F',
  status: 'captured',
  overrideUsed: false,
  amount: '59.00',
  currency: 'USD',
  createdAt: new Date(NOW - HOUR),
  storeName: 'Velbrook Supply',
  storeUrl: 'https://voircheck-stores.onrender.com/s/velbrook-supply',
  productTitle: 'Zephlet Buds',
  scanId: 'scan-1',
  verdict: 'SAFE',
  riskScore: 4,
  signals: [],
  receiptSlug: 'slug-1',
  ...over,
});

describe('History → Orders: one status per order', () => {
  it.each([
    ['captured', false, 1, 'paid'],
    ['captured', true, 1, 'paid'],
    ['refund_pending', false, 1, 'refund_pending'],
    ['refunded', false, 1, 'refunded'],
    ['created', false, 1, 'waiting'],
    ['approved', false, 1, 'waiting'],
    ['created', false, 7, 'expired'],
    ['authorized', false, 1, 'held'],
    ['replaced', false, 1, 'replaced'],
    ['voided', false, 1, 'voided'],
    ['cancelled', false, 1, 'not_paid'],
    ['capture_denied', false, 1, 'not_paid'],
  ])('%s (override %s, %sh old) → %s', (status, overrideUsed, hours, expected) => {
    expect(orderStatus({ status, overrideUsed, createdAt: new Date(NOW - hours * HOUR) }, NOW)).toBe(expected);
  });

  it('two orders in one conversation are two cards, each with its own status (no "waiting" + "refunded" mix)', () => {
    const cards = toOrderCards(
      [
        rec({ paymentId: 'pay-old', ref: 'VC-NV8S', status: 'replaced', amount: '24.99', storeName: 'Ondaya Home', receiptSlug: null, createdAt: new Date(NOW - 2 * HOUR) }),
        rec({ paymentId: 'pay-new', ref: 'VC-GVLZ', status: 'refunded' }),
      ],
      NOW,
    );
    expect(cards.map((c) => [c.ref, c.status])).toEqual([
      ['VC-GVLZ', 'refunded'],
      ['VC-NV8S', 'replaced'],
    ]);
    expect(cards.every((c) => !c.refundable && !c.needsYou)).toBe(true);
  });

  it('a chat order links to the scan it was decided on (payments.scan_id)', () => {
    const [card] = toOrderCards([rec({ sessionId: 'sess-chat', scanId: 'scan-velbrook' })], NOW);
    expect(card).toMatchObject({ scanId: 'scan-velbrook', receiptSlug: 'slug-1', refundable: true, needsYou: false });
  });

  it('only a paid order is refundable; waiting and held ones need the person', () => {
    const cards = toOrderCards([rec({ paymentId: 'a', status: 'captured' }), rec({ paymentId: 'b', status: 'created', receiptSlug: null }), rec({ paymentId: 'c', status: 'authorized' }), rec({ paymentId: 'd', status: 'refund_pending' })], NOW);
    expect(Object.fromEntries(cards.map((c) => [c.paymentId, [c.refundable, c.needsYou]]))).toEqual({ a: [true, false], b: [false, true], c: [false, true], d: [false, false] });
  });

  it('drops a repeated row for the same order', () => {
    expect(toOrderCards([rec({}), rec({})], NOW)).toHaveLength(1);
  });
});

describe('History → Orders totals', () => {
  it('Paid and Refunded per currency, and Waiting for you', () => {
    const t = orderTotals(
      toOrderCards(
        [
          rec({ paymentId: 'a', status: 'captured', amount: '24.00' }),
          rec({ paymentId: 'b', status: 'captured', amount: '10.10', currency: 'EUR' }),
          rec({ paymentId: 'c', status: 'refunded', amount: '59.00' }),
          rec({ paymentId: 'd', status: 'voided', amount: '23.00' }),
          rec({ paymentId: 'e', status: 'created', amount: '5.00' }),
          rec({ paymentId: 'f', status: 'authorized', amount: '7.00' }),
          rec({ paymentId: 'g', status: 'replaced', amount: '24.99' }),
          rec({ paymentId: 'h', status: 'created', amount: '9.00', createdAt: new Date(NOW - 8 * HOUR) }),
        ],
        NOW,
      ),
    );
    expect(t).toEqual({ paidByCurrency: { USD: 24, EUR: 10.1 }, refundedByCurrency: { USD: 59 }, waiting: 2 });
  });
});
