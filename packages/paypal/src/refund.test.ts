import { describe, expect, it } from 'vitest';
import { decideRefund, MoneyGate, REFUND_WINDOW_MS, requestIdFor, type RefundOutcome, type Refunder } from './gate';
import { fakePayPal, NOW, OTHER_USER, seededStore, USER } from './test-helpers';

/** A refunder like PayPal's: a repeated PayPal-Request-Id returns the first refund instead of a second one. */
function fakeRefunder(answer: (n: number) => RefundOutcome = (n) => ({ kind: 'refund', refundId: `REF-${n}`, status: 'COMPLETED' })) {
  const calls: Array<{ captureId: string; requestId: string }> = [];
  const byRequestId = new Map<string, RefundOutcome>();
  const refunder: Refunder = async (input) => {
    calls.push(input);
    const seen = byRequestId.get(input.requestId);
    if (seen) return seen;
    const out = answer(calls.length);
    if (out.kind === 'refund') byRequestId.set(input.requestId, out);
    return out;
  };
  return { refunder, calls };
}

async function setup(opts: { refunder?: Refunder; status?: 'captured' | 'authorized' | 'voided' | 'capture_pending'; userId?: string } = {}) {
  const pp = fakePayPal();
  const { store, candidate } = seededStore();
  const payment = await store.insertPayment({
    userId: opts.userId ?? USER,
    sessionId: candidate.sessionId,
    candidateId: candidate.id,
    scanId: 'scan-safe',
    paypalOrderId: 'ORDER7',
    authorizationId: 'AUTH-7',
    captureId: opts.status === 'authorized' || opts.status === 'voided' ? null : 'CAP-7',
    storeSlug: 'velbrook-supply',
    amount: '59.00',
    currency: 'USD',
    status: opts.status ?? 'captured',
    mode: 'approve',
    overrideUsed: false,
  });
  store.payments.get(payment.id)!.createdAt = new Date(NOW.getTime() - 86_400_000);
  const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW, refunder: opts.refunder });
  return { pp, store, gate, payment };
}

describe('decideRefund', () => {
  const p = { status: 'captured' as const, captureId: 'CAP-1', createdAt: new Date(NOW.getTime() - 86_400_000) };
  it('captured, inside PayPal’s 180 days → allowed', () => {
    expect(decideRefund(p, NOW)).toEqual({ allowed: true });
  });
  it.each([
    [{ status: 'refunded' }, 'already_refunded'],
    [{ status: 'refund_pending' }, 'refund_pending'],
    [{ status: 'authorized' }, 'not_captured'],
    [{ status: 'voided' }, 'not_captured'],
    [{ status: 'capture_pending' }, 'not_captured'],
    [{ captureId: null }, 'not_captured'],
    [{ createdAt: new Date(NOW.getTime() - REFUND_WINDOW_MS) }, 'too_old'],
  ] as const)('%j → %s', (patch, reason) => {
    expect(decideRefund({ ...p, ...patch }, NOW)).toEqual({ allowed: false, reason });
  });
});

describe('MoneyGate.userRefund', () => {
  it('refunds the person’s own captured payment in full, once, keyed on the payment', async () => {
    const r = fakeRefunder();
    const { gate, store, payment } = await setup({ refunder: r.refunder });
    const out = await gate.userRefund({ userId: USER, paymentId: payment.id });
    expect(out).toMatchObject({ ok: true, payment: { status: 'refunded', refundId: 'REF-1' } });
    expect(r.calls).toEqual([{ captureId: 'CAP-7', requestId: requestIdFor('refund', payment.id) }]);
    expect(store.audit.map((a) => a.action)).toEqual(['refund.requested', 'payment.refunded']);
    expect(store.audit.every((a) => a.actor === 'user')).toBe(true);
  });

  it('can’t refund twice: a second tap is answered from our row, PayPal isn’t asked again', async () => {
    const r = fakeRefunder();
    const { gate, payment } = await setup({ refunder: r.refunder });
    await gate.userRefund({ userId: USER, paymentId: payment.id });
    const again = await gate.userRefund({ userId: USER, paymentId: payment.id });
    expect(again).toMatchObject({ ok: true, payment: { status: 'refunded' } });
    expect(r.calls).toHaveLength(1);
  });

  it('two taps at once still make one refund (per-payment lock + same request id)', async () => {
    const r = fakeRefunder();
    const { gate, payment } = await setup({ refunder: r.refunder });
    const [a, b] = await Promise.all([gate.userRefund({ userId: USER, paymentId: payment.id }), gate.userRefund({ userId: USER, paymentId: payment.id })]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(r.calls).toHaveLength(1);
  });

  it('can’t refund someone else’s payment', async () => {
    const r = fakeRefunder();
    const { gate, payment } = await setup({ refunder: r.refunder });
    expect(await gate.userRefund({ userId: OTHER_USER, paymentId: payment.id })).toEqual({ ok: false, reason: 'payment not found' });
    expect(r.calls).toHaveLength(0);
  });

  it.each(['authorized', 'voided', 'capture_pending'] as const)('a %s payment is refused, PayPal not asked', async (status) => {
    const r = fakeRefunder();
    const { gate, store, payment } = await setup({ refunder: r.refunder, status });
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: false, reason: 'not_captured' });
    expect(r.calls).toHaveLength(0);
    expect(store.audit.at(-1)).toMatchObject({ action: 'refund.refused', details: { reason: 'not_captured' } });
  });

  it('past PayPal’s window → refused', async () => {
    const r = fakeRefunder();
    const { gate, store, payment } = await setup({ refunder: r.refunder });
    store.payments.get(payment.id)!.createdAt = new Date(NOW.getTime() - REFUND_WINDOW_MS - 1);
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: false, reason: 'too_old' });
    expect(r.calls).toHaveLength(0);
  });

  it('PENDING refund → refund_pending (the webhook finishes it)', async () => {
    const r = fakeRefunder(() => ({ kind: 'refund', refundId: 'REF-P', status: 'PENDING' }));
    const { gate, payment } = await setup({ refunder: r.refunder });
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: true, payment: { status: 'refund_pending', refundId: 'REF-P' } });
  });

  it('PayPal refuses → still captured, failure audited', async () => {
    const r = fakeRefunder(() => ({ kind: 'error', message: 'UNPROCESSABLE_ENTITY' }));
    const { gate, store, payment } = await setup({ refunder: r.refunder });
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: false, payment: { status: 'captured' } });
    expect(store.audit.at(-1)).toMatchObject({ action: 'payment.refund_failed' });
  });

  it('no answer from PayPal → nothing assumed; the retry reuses the same request id', async () => {
    let n = 0;
    const r = fakeRefunder(() => (++n === 1 ? { kind: 'unknown', message: 'timeout' } : { kind: 'refund', refundId: 'REF-2', status: 'COMPLETED' }));
    const { gate, store, payment } = await setup({ refunder: r.refunder });
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: false, payment: { status: 'captured' } });
    expect(store.audit.at(-1)).toMatchObject({ action: 'payment.refund_unknown' });
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: true, payment: { status: 'refunded' } });
    expect(new Set(r.calls.map((c) => c.requestId)).size).toBe(1);
  });

  it('already refunded in the PayPal dashboard → recorded as refunded', async () => {
    const r = fakeRefunder(() => ({ kind: 'already_refunded' }));
    const { gate, payment } = await setup({ refunder: r.refunder });
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: true, payment: { status: 'refunded' } });
  });

  it('no refunder configured → refused, nothing moves', async () => {
    const { gate, payment } = await setup();
    expect(await gate.userRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: false, payment: { status: 'captured' } });
  });
});

describe('MoneyGate.agentProposeRefund (the agent can only propose)', () => {
  it('checks and audits as the agent, never calls PayPal or changes the row', async () => {
    const r = fakeRefunder();
    const { gate, store, payment } = await setup({ refunder: r.refunder });
    expect(await gate.agentProposeRefund({ userId: USER, paymentId: payment.id })).toMatchObject({ ok: true, payment: { id: payment.id, amount: '59.00' } });
    expect(r.calls).toHaveLength(0);
    expect(store.payments.get(payment.id)?.status).toBe('captured');
    expect(store.audit).toEqual([expect.objectContaining({ actor: 'agent', action: 'agent.refund_proposed' })]);
  });

  it('someone else’s payment, or one already refunded → refused', async () => {
    const { gate, store, payment } = await setup({ refunder: fakeRefunder().refunder });
    expect(await gate.agentProposeRefund({ userId: OTHER_USER, paymentId: payment.id })).toEqual({ ok: false, reason: 'not_found' });
    await store.updatePayment(payment.id, { status: 'refunded' });
    expect(await gate.agentProposeRefund({ userId: USER, paymentId: payment.id })).toEqual({ ok: false, reason: 'already_refunded' });
  });
});
