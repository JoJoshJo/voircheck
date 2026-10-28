import { describe, expect, it } from 'vitest';
import { decideAutopay, decideCapture, decideReauthorize, effectiveVerdict, MoneyGate, scanCoversStore, storeSlugFor, type EffectiveVerdict } from './gate';
import { fakePayPal, NOW, OTHER_USER, seededStore, USER } from './test-helpers';

const DAY = 86_400_000;
const urls = { returnUrl: 'https://voircheck.test/return', cancelUrl: 'https://voircheck.test/cancel' };

function setup(paypalOpts: Parameters<typeof fakePayPal>[0] = {}) {
  const pp = fakePayPal(paypalOpts);
  const { store, candidate } = seededStore();
  const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
  return { pp, store, candidate, gate };
}

async function authorized(scanId: string | null, paypalOpts: Parameters<typeof fakePayPal>[0] = {}) {
  const s = setup(paypalOpts);
  const started = await s.gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId, idempotencyKey: 'click-0001', ...urls });
  if (!started.ok) throw new Error(started.reason);
  return { ...s, paymentId: started.payment.id };
}

// ---------- pure decisions ----------

describe('decideCapture (approve mode)', () => {
  it.each<[EffectiveVerdict, 'system' | 'user', boolean, string, boolean?]>([
    ['SAFE', 'system', false, 'capture'],
    ['HOLD', 'system', false, 'hold'],
    ['UNVERIFIED', 'system', false, 'hold'],
    ['BLOCK', 'system', false, 'void'],
    ['BLOCK', 'system', true, 'void'], // the system never uses an override
    ['SAFE', 'user', false, 'capture'],
    ['HOLD', 'user', false, 'capture'],
    ['UNVERIFIED', 'user', false, 'capture'],
    ['BLOCK', 'user', false, 'refuse'],
    ['BLOCK', 'user', true, 'capture', true],
  ])('%s + %s trigger + override=%s → %s', (verdict, trigger, override, action, overrideUsed = false) => {
    const d = decideCapture({ verdict, trigger, override });
    expect(d.action).toBe(action);
    if (d.action === 'capture') expect(d.overrideUsed).toBe(overrideUsed);
  });
});

describe('decideAutopay', () => {
  const ok = { verdict: 'SAFE' as EffectiveVerdict, autopayEnabled: true, autopayLimit: '100.00', amount: '59.00', currency: 'USD', hasVaultToken: true, overrideRequested: false };
  it('SAFE + within limit → allowed (limit is inclusive)', () => {
    expect(decideAutopay(ok)).toEqual({ allowed: true });
    expect(decideAutopay({ ...ok, amount: '100.00' })).toEqual({ allowed: true });
  });
  it.each([
    [{ verdict: 'BLOCK' }, 'BLOCK verdict'],
    [{ verdict: 'BLOCK', overrideRequested: true }, 'override is never allowed in Auto-pay'],
    [{ overrideRequested: true }, 'override is never allowed in Auto-pay'],
    [{ verdict: 'HOLD' }, 'HOLD verdict'],
    [{ verdict: 'UNVERIFIED' }, "can't verify the store"],
    [{ amount: '100.01' }, 'amount is over the Auto-pay limit'],
    [{ autopayLimit: null }, 'no Auto-pay limit set'],
    [{ autopayEnabled: false }, 'Auto-pay is off'],
    [{ hasVaultToken: false }, 'no saved PayPal wallet'],
    [{ currency: 'EUR' }, 'Auto-pay limit is in USD'],
  ])('%j → refused: %s', (patch, reason) => {
    expect(decideAutopay({ ...ok, ...(patch as object) })).toEqual({ allowed: false, reason });
  });
});

describe('decideReauthorize', () => {
  const at = new Date('2026-10-01T12:00:00Z');
  it.each([
    [0, false],
    [2.99, false], // still inside the 3-day honor period
    [3, true], // day 4
    [28.9, true],
    [29, false], // expired
  ])('%f days after authorization → allowed=%s', (days, allowed) => {
    expect(decideReauthorize({ authorizedAt: at, now: new Date(at.getTime() + days * DAY), alreadyReauthorized: false }).allowed).toBe(allowed);
  });
  it('only once', () => {
    expect(decideReauthorize({ authorizedAt: at, now: new Date(at.getTime() + 5 * DAY), alreadyReauthorized: true })).toEqual({ allowed: false, reason: 'already reauthorized once' });
  });
});

describe('scan freshness and matching', () => {
  const { store, candidate } = seededStore();
  it('missing, stale, or other-store scans are UNVERIFIED', async () => {
    expect(effectiveVerdict(null, candidate, NOW).verdict).toBe('UNVERIFIED');
    expect(effectiveVerdict((await store.getScan('scan-stale'))!, candidate, NOW)).toEqual({ verdict: 'UNVERIFIED', why: 'scan is stale' });
    expect(effectiveVerdict((await store.getScan('scan-other-store'))!, candidate, NOW).why).toBe('scan is for a different store');
    expect(effectiveVerdict((await store.getScan('scan-block'))!, candidate, NOW).verdict).toBe('BLOCK');
  });
  it('demo stores share a host, so the path must match too', () => {
    expect(scanCoversStore('https://voircheck-stores.onrender.com/s/velbrook-supply/products/x', 'https://voircheck-stores.onrender.com/s/velbrook-supply')).toBe(true);
    expect(scanCoversStore('https://voircheck-stores.onrender.com/s/velbrook-supply-x', 'https://voircheck-stores.onrender.com/s/velbrook-supply')).toBe(false);
    expect(scanCoversStore('https://www.bestbuy.com/site/p', 'https://bestbuy.com/')).toBe(true);
    expect(scanCoversStore('https://bestbuy.com.evil.shop/', 'https://bestbuy.com/')).toBe(false);
  });
  it('store slug: demo slug from the URL, retailer slug from the domain', () => {
    expect(storeSlugFor(candidate)).toBe('velbrook-supply');
    expect(storeSlugFor({ source: 'channel3', storeUrl: 'https://www.bestbuy.com/' })).toBe('bestbuy-com');
    expect(() => storeSlugFor({ source: 'demo', storeUrl: 'https://voircheck-stores.onrender.com/s/not-a-store' })).toThrow();
  });
});

// ---------- approve mode, end to end with fake PayPal ----------

describe('approve mode', () => {
  it('creates an AUTHORIZE order from the DB row: no payee, custom_id = store slug, browser price ignored', async () => {
    const { gate, pp } = setup();
    const r = await gate.startApprovePurchase({
      userId: USER,
      candidateId: 'cand-1',
      scanId: 'scan-safe',
      idempotencyKey: 'click-0001',
      ...urls,
      // What a tampered browser might send; the input schema strips it.
      ...({ amount: '0.01', price: 0.01, storeSlug: 'evil', payee: { email_address: 'x@evil.test' } } as object),
    });
    expect(r.ok && r.approvalUrl).toContain('sandbox.paypal.com');
    const body = pp.callsTo(/POST \/v2\/checkout\/orders$/)[0]!.body as { intent: string; purchase_units: Array<Record<string, unknown>> };
    expect(body.intent).toBe('AUTHORIZE');
    expect(body.purchase_units[0]).toEqual({ amount: { currency_code: 'USD', value: '59.00' }, custom_id: 'velbrook-supply', description: 'Velbrook Supply' });
    expect(JSON.stringify(body)).not.toContain('payee');
    expect(r.ok && r.payment).toMatchObject({ amount: '59.00', storeSlug: 'velbrook-supply', status: 'created', mode: 'approve' });
  });

  it('double click (same idempotency key) → one PayPal request id, one order, one payment row', async () => {
    const { gate, pp, store } = setup();
    const input = { userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'click-0001', ...urls };
    const [a, b] = await Promise.all([gate.startApprovePurchase(input), gate.startApprovePurchase(input)]);
    const creates = pp.callsTo(/POST \/v2\/checkout\/orders$/);
    expect(creates).toHaveLength(2);
    expect(creates[0]!.requestId).toBe(creates[1]!.requestId);
    expect(a.ok && b.ok && a.payment.id === b.payment.id).toBe(true);
    expect(store.payments.size).toBe(1);
  });

  it("refuses another user's candidate, and audits it", async () => {
    const { gate, pp, store } = setup();
    const r = await gate.startApprovePurchase({ userId: OTHER_USER, candidateId: 'cand-1', idempotencyKey: 'click-0001', ...urls });
    expect(r).toEqual({ ok: false, reason: 'candidate not found' });
    expect(pp.callsTo(/orders/)).toHaveLength(0);
    expect(store.audit.at(-1)).toMatchObject({ action: 'purchase.refused', userId: OTHER_USER });
  });

  it('SAFE → authorized then captured automatically', async () => {
    const { gate, pp, paymentId, store } = await authorized('scan-safe');
    const r = await gate.completeApproval(paymentId, USER);
    expect(r.ok && r.payment).toMatchObject({ status: 'captured', captureId: 'CAP-AUTH-ORDER1', overrideUsed: false });
    expect(pp.callsTo(/capture$/)).toHaveLength(1);
    expect(store.audit.map((a) => a.action)).toEqual(['order.created', 'authorization.created', 'gate.capture', 'payment.captured']);
  });

  it.each(['scan-hold', 'scan-stale', 'scan-other-store', null])('%s → held, never captured automatically', async (scanId) => {
    const { gate, pp, paymentId } = await authorized(scanId);
    const r = await gate.completeApproval(paymentId, USER);
    expect(r.ok && r.payment.status).toBe('authorized');
    expect(pp.callsTo(/capture$|void$/)).toHaveLength(0);
  });

  it('BLOCK → voided automatically', async () => {
    const { gate, pp, paymentId, store } = await authorized('scan-block');
    const r = await gate.completeApproval(paymentId, USER);
    expect(r.ok && r.payment.status).toBe('voided');
    expect(pp.callsTo(/capture$/)).toHaveLength(0);
    expect(store.audit.map((a) => a.action)).toContain('gate.void');
  });

  it('HOLD + explicit user Capture → captured, audited as a user action', async () => {
    const { gate, paymentId, store } = await authorized('scan-hold');
    await gate.completeApproval(paymentId, USER);
    const r = await gate.userCapture({ userId: USER, paymentId });
    expect(r.ok && r.payment.status).toBe('captured');
    expect(store.audit.find((a) => a.action === 'gate.capture' && a.actor === 'user')?.details).toMatchObject({ verdict: 'HOLD', trigger: 'user' });
  });

  it('BLOCK + user Capture without override → refused, nothing captured, audited', async () => {
    const { gate, pp, paymentId, store } = await authorized('scan-block');
    // Simulate the hold still being open (e.g. void failed) so a capture is even possible.
    await store.updatePayment(paymentId, { status: 'authorized', authorizationId: 'AUTH-X' });
    const r = await gate.userCapture({ userId: USER, paymentId });
    expect(r).toMatchObject({ ok: false, reason: 'BLOCK verdict needs an explicit override' });
    expect(pp.callsTo(/capture$/)).toHaveLength(0);
    expect(store.audit.at(-1)).toMatchObject({ action: 'gate.refuse', actor: 'user', details: { verdict: 'BLOCK', override: false } });
  });

  it('BLOCK + explicit override in approve mode → captured, override_used = true, audited', async () => {
    const { gate, pp, paymentId, store } = await authorized('scan-block');
    await store.updatePayment(paymentId, { status: 'authorized', authorizationId: 'AUTH-X' });
    const r = await gate.userCapture({ userId: USER, paymentId, override: true });
    expect(r.ok && r.payment).toMatchObject({ status: 'captured', overrideUsed: true });
    expect(pp.callsTo(/capture$/)).toHaveLength(1);
    expect(store.audit.filter((a) => a.action === 'payment.captured').at(-1)?.details).toMatchObject({ overrideUsed: true });
  });

  it("user can't capture someone else's payment", async () => {
    const { gate, paymentId } = await authorized('scan-hold');
    await gate.completeApproval(paymentId, USER);
    expect(await gate.userCapture({ userId: OTHER_USER, paymentId })).toEqual({ ok: false, reason: 'payment not found' });
  });

  it('void is always allowed on a held payment', async () => {
    const { gate, paymentId } = await authorized('scan-hold');
    await gate.completeApproval(paymentId, USER);
    expect((await gate.userVoid({ userId: USER, paymentId })).ok).toBe(true);
  });

  it('capture/void reuse a per-payment PayPal-Request-Id (retries are idempotent)', async () => {
    const { gate, pp, paymentId } = await authorized('scan-safe');
    await gate.completeApproval(paymentId, USER);
    await gate.completeApproval(paymentId, USER); // already captured: no second PayPal call
    expect(pp.callsTo(/capture$/)).toHaveLength(1);
    expect(pp.callsTo(/capture$/)[0]!.requestId).toMatch(/^vc-[0-9a-f]{40}$/);
  });

  it('saved wallet: only the vault token ID and status are stored', async () => {
    const { gate, paymentId, store } = await authorized('scan-hold', { vaultOnAuthorize: 'VAULT-TOKEN-1' });
    await gate.completeApproval(paymentId, USER);
    expect(store.vaultTokens).toEqual([{ userId: USER, paypalVaultTokenId: 'VAULT-TOKEN-1', status: 'VAULTED' }]);
    expect(JSON.stringify(store.audit)).not.toContain('buyer@example.com');
  });
});

describe('reauthorize', () => {
  it('refused before day 4 (no PayPal call), allowed on day 4, then refused the second time', async () => {
    const early = await authorized('scan-hold', { authCreateTime: new Date(NOW.getTime() - 2 * DAY).toISOString() });
    await early.gate.completeApproval(early.paymentId, USER);
    expect(await early.gate.reauthorize({ userId: USER, paymentId: early.paymentId })).toMatchObject({ ok: false, reason: expect.stringContaining('from day 4') });
    expect(early.pp.callsTo(/reauthorize$/)).toHaveLength(0);

    const later = await authorized('scan-hold', { authCreateTime: new Date(NOW.getTime() - 4 * DAY).toISOString() });
    await later.gate.completeApproval(later.paymentId, USER);
    const first = await later.gate.reauthorize({ userId: USER, paymentId: later.paymentId });
    expect(first.ok && first.payment.authorizationId).toBe('RE-AUTH-ORDER1');
    expect(await later.gate.reauthorize({ userId: USER, paymentId: later.paymentId })).toMatchObject({ ok: false, reason: 'already reauthorized once' });
    expect(later.pp.callsTo(/reauthorize$/)).toHaveLength(1);
  });
});

// ---------- auto-pay ----------

describe('auto-pay', () => {
  const vaulted = () => {
    const s = setup();
    s.store.vaultTokens.push({ userId: USER, paypalVaultTokenId: 'VAULT-TOKEN-1', status: 'VAULTED' });
    return s;
  };

  it('SAFE within limit → one direct CAPTURE with the saved wallet, no payee, DB price', async () => {
    const { gate, pp, store } = vaulted();
    const r = await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0001', ...({ amount: '1.00' } as object) });
    expect(r.ok && r.payment).toMatchObject({ status: 'captured', mode: 'auto', amount: '59.00', captureId: 'CAP-ORDER1' });
    const body = pp.callsTo(/POST \/v2\/checkout\/orders$/)[0]!.body as Record<string, unknown>;
    expect(body).toEqual({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: '59.00' }, custom_id: 'velbrook-supply', description: 'Velbrook Supply' }],
      payment_source: { paypal: { vault_id: 'VAULT-TOKEN-1' } },
    });
    // Verdict check is audited BEFORE the capture.
    const actions = store.audit.map((a) => a.action);
    expect(actions.indexOf('autopay.allowed')).toBeLessThan(actions.indexOf('autopay.captured'));
  });

  it.each([
    ['scan-block', false, 'BLOCK verdict'],
    ['scan-block', true, 'override is never allowed in Auto-pay'],
    ['scan-hold', false, 'HOLD verdict'],
    ['scan-stale', false, "can't verify the store"],
    ['scan-other-store', false, "can't verify the store"],
    [null, false, "can't verify the store"],
  ])('%s (override=%s) → refused before any PayPal order: %s', async (scanId, override, reason) => {
    const { gate, pp, store } = vaulted();
    const r = await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId, idempotencyKey: 'auto-0001', override });
    expect(r).toEqual({ ok: false, reason });
    expect(pp.callsTo(/orders/)).toHaveLength(0);
    expect(store.audit.at(-1)).toMatchObject({ action: 'autopay.refused', details: { reason } });
  });

  it('over the limit, Auto-pay off, or no saved wallet → refused', async () => {
    const a = vaulted();
    a.store.profiles.set(USER, { userId: USER, autopayEnabled: true, autopayLimit: '50.00' });
    expect(await a.gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0001' })).toEqual({ ok: false, reason: 'amount is over the Auto-pay limit' });
    a.store.profiles.set(USER, { userId: USER, autopayEnabled: false, autopayLimit: '500.00' });
    expect(await a.gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0001' })).toEqual({ ok: false, reason: 'Auto-pay is off' });
    const b = setup();
    expect(await b.gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0001' })).toEqual({ ok: false, reason: 'no saved PayPal wallet' });
    expect(a.pp.callsTo(/orders/).length + b.pp.callsTo(/orders/).length).toBe(0);
  });

  it('auto-pay payments have no user capture/override path', async () => {
    const { gate, store } = vaulted();
    const r = await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0001' });
    const paymentId = r.ok ? r.payment.id : '';
    expect(await gate.userCapture({ userId: USER, paymentId, override: true })).toMatchObject({ ok: false, reason: 'auto-pay payments have no user capture step' });
    expect(store.audit.at(-1)).toMatchObject({ action: 'gate.refuse', details: { override: true } });
  });

  it('every gate decision writes an audit row', async () => {
    const { gate, store } = vaulted();
    const before = store.audit.length;
    await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-block', idempotencyKey: 'auto-0001' });
    await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0002' });
    expect(store.audit.length - before).toBe(3); // refused + allowed + captured
  });
});
