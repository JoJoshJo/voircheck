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

  it('a candidate with no known price (pasted link) can never be charged', async () => {
    const { gate, pp, store } = setup();
    store.candidates.get('cand-1')!.price = null;
    expect(await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'click-0001', ...urls })).toEqual({ ok: false, reason: 'no known price for this store' });
    store.vaultTokens.push({ userId: USER, paypalVaultTokenId: 'V', status: 'VAULTED' });
    expect(await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0001' })).toEqual({ ok: false, reason: 'no known price for this store' });
    expect(pp.callsTo(/orders/)).toHaveLength(0);
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
    // Seeded user has Auto-pay on and no saved wallet, so this first purchase also asks PayPal to save it.
    expect(store.audit.map((a) => a.action)).toEqual(['wallet.save_requested', 'order.created', 'authorization.created', 'gate.capture', 'payment.captured']);
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

// ---------- "Pay anyway", cancel, wallet setup ----------

describe('Pay anyway (BLOCK override in approve mode)', () => {
  it('a new order with the confirmed override is captured after approval, audited as the user', async () => {
    const { gate, pp, store } = setup();
    const r = await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-block', idempotencyKey: 'override-0001', override: true, ...urls });
    expect(r.ok && r.payment.overrideUsed).toBe(true);
    const done = await gate.completeApproval(r.ok ? r.payment.id : '', USER);
    expect(done.ok && done.payment).toMatchObject({ status: 'captured', overrideUsed: true });
    expect(pp.callsTo(/void$/)).toHaveLength(0);
    const actions = store.audit.map((a) => `${a.actor}:${a.action}`);
    expect(actions).toEqual(['user:override.confirmed', 'user:order.created', 'system:authorization.created', 'user:gate.capture', 'user:payment.captured']);
  });

  it('without the override, the same BLOCK store is voided', async () => {
    const { gate } = setup();
    const r = await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-block', idempotencyKey: 'normal-0001', ...urls });
    expect((await gate.completeApproval(r.ok ? r.payment.id : '', USER)).payment?.status).toBe('voided');
  });

  it('Auto-pay never accepts an override, even with a saved wallet and a high limit', async () => {
    const { gate, pp, store } = setup();
    store.vaultTokens.push({ userId: USER, paypalVaultTokenId: 'V', status: 'VAULTED' });
    store.profiles.set(USER, { userId: USER, autopayEnabled: true, autopayLimit: '1000.00' });
    expect(await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-block', idempotencyKey: 'auto-0009', override: true })).toEqual({ ok: false, reason: 'override is never allowed in Auto-pay' });
    expect(pp.callsTo(/orders/)).toHaveLength(0);
  });
});

describe('popup closed / cancelled', () => {
  it('an unapproved order is marked cancelled; nothing was held', async () => {
    const pp = fakePayPal({ orderStatus: 'PAYER_ACTION_REQUIRED' });
    const { store } = seededStore();
    const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
    const r = await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'click-0001', ...urls });
    const c = await gate.cancelPurchase({ userId: USER, paymentId: r.ok ? r.payment.id : '' });
    expect(c.ok && c.payment.status).toBe('cancelled');
    expect(pp.callsTo(/authorize$/)).toHaveLength(0);
  });

  it('if the buyer approved after all (sandbox second click), cancel refuses and the approval is finished instead', async () => {
    const { gate, paymentId } = await authorized('scan-safe');
    expect(await gate.cancelPurchase({ userId: USER, paymentId })).toMatchObject({ ok: false, reason: 'already approved' });
    expect((await gate.completeApproval(paymentId, USER)).payment?.status).toBe('captured');
  });
});

describe('saving a wallet for Auto-pay (no purchase)', () => {
  it('setup token → approved → payment token ID stored, nothing else', async () => {
    const { gate, pp, store } = setup();
    const { setupTokenId } = await gate.startWalletSetup({ userId: USER, ...urls });
    expect(await gate.confirmWalletSetup({ userId: USER, setupTokenId })).toEqual({ ok: true });
    expect(store.vaultTokens).toEqual([{ userId: USER, paypalVaultTokenId: `PTOKEN-${setupTokenId}`, status: 'VAULTED' }]);
    const setupBody = pp.callsTo(/setup-tokens/)[0]!.body as { payment_source: { paypal: { usage_type: string } } };
    expect(setupBody.payment_source.paypal.usage_type).toBe('MERCHANT');
  });

  it("refuses to confirm a setup token another user started", async () => {
    const { gate, store } = setup();
    const { setupTokenId } = await gate.startWalletSetup({ userId: OTHER_USER, ...urls });
    expect(await gate.confirmWalletSetup({ userId: USER, setupTokenId })).toEqual({ ok: false, reason: 'unknown setup token' });
    expect(store.vaultTokens).toHaveLength(0);
  });

  it('browser-safe client token is scoped to the page origin', async () => {
    const { pp } = setup();
    expect(await pp.client.browserClientToken(['voircheck-web.onrender.com'])).toEqual({ token: 'browser-safe-token', expiresIn: 900 });
    const body = pp.calls.find((c) => c.path.endsWith('#client_token'))!.body as string;
    expect(new URLSearchParams(body).get('domains[]')).toBe('voircheck-web.onrender.com');
  });
});

describe('two paths settling the same payment (browser + webhook)', () => {
  it('a payment already settled elsewhere is not captured or voided again', async () => {
    const { gate, pp, store, paymentId } = await authorized('scan-safe');
    await gate.completeApproval(paymentId, USER); // first path captures
    store.payments.get(paymentId)!.status = 'authorized'; // simulate the second path having read a stale row…
    store.payments.get(paymentId)!.status = 'voided'; // …while the first actually finished as voided
    const r = await gate.userCapture({ userId: USER, paymentId });
    expect(r.ok).toBe(false);
    expect(pp.callsTo(/capture$/)).toHaveLength(1);
  });
});

describe('concurrent duplicates (React double effect, double click, webhook + browser)', () => {
  it('two simultaneous auto-pay requests with the same key charge once', async () => {
    const pp = fakePayPal({ slowMs: 30 });
    const { store } = seededStore();
    store.vaultTokens.push({ userId: USER, paypalVaultTokenId: 'V', status: 'VAULTED' });
    const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
    const input = { userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'auto-0001' };
    const [a, b] = await Promise.all([gate.autoPay(input), gate.autoPay(input)]);
    expect(a.ok && b.ok && a.payment.id === b.payment.id).toBe(true);
    expect(new Set([...store.payments.values()].map((p) => p.paypalOrderId)).size).toBe(1);
  });

  it('two simultaneous completions of one approval capture once', async () => {
    const pp = fakePayPal({ slowMs: 30 });
    const { store } = seededStore();
    const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
    const r = await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'click-0001', ...urls });
    const id = r.ok ? r.payment.id : '';
    await Promise.all([gate.completeApproval(id, USER, 'user'), gate.completeApproval(id, USER, 'webhook')]);
    expect(store.payments.get(id)?.status).toBe('captured');
    expect(store.audit.filter((x) => x.action === 'payment.captured')).toHaveLength(1);
  });
});

describe('saving the wallet during a purchase (Auto-pay on, nothing saved yet)', () => {
  it('the approval order asks PayPal to vault; only the token ID is stored after authorization', async () => {
    const pp = fakePayPal({ vaultOnAuthorize: 'VAULT-NEW' });
    const { store } = seededStore(); // Auto-pay on, $100 limit, no wallet
    const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
    const r = await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'first-0001', ...urls });
    const body = pp.callsTo(/POST \/v2\/checkout\/orders$/)[0]!.body as { payment_source: { paypal: { attributes?: { vault?: Record<string, string> } } } };
    expect(body.payment_source.paypal.attributes?.vault).toEqual({ store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' });
    await gate.completeApproval(r.ok ? r.payment.id : '', USER);
    expect(store.vaultTokens).toEqual([{ userId: USER, paypalVaultTokenId: 'VAULT-NEW', status: 'VAULTED' }]);
    expect(JSON.stringify(store.audit)).not.toContain('buyer@example.com');
  });

  it('then the next purchase is charged automatically with that wallet', async () => {
    const pp = fakePayPal({ vaultOnAuthorize: 'VAULT-NEW' });
    const { store } = seededStore();
    const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
    const first = await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'first-0001', ...urls });
    await gate.completeApproval(first.ok ? first.payment.id : '', USER);
    const second = await gate.autoPay({ userId: USER, candidateId: 'cand-1', scanId: 'scan-safe', idempotencyKey: 'second-0001' });
    expect(second.ok && second.payment).toMatchObject({ mode: 'auto', status: 'captured' });
    const lastBody = pp.callsTo(/POST \/v2\/checkout\/orders$/).at(-1)!.body as { payment_source: unknown };
    expect(lastBody.payment_source).toEqual({ paypal: { vault_id: 'VAULT-NEW' } });
  });

  it('no vault request when Auto-pay is off, a wallet is already saved, or on a "Pay anyway" order', async () => {
    for (const setupCase of ['off', 'saved', 'override'] as const) {
      const pp = fakePayPal();
      const { store } = seededStore();
      if (setupCase === 'off') store.profiles.set(USER, { userId: USER, autopayEnabled: false, autopayLimit: null });
      if (setupCase === 'saved') store.vaultTokens.push({ userId: USER, paypalVaultTokenId: 'V', status: 'VAULTED' });
      const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
      await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-block', idempotencyKey: `case-${setupCase}`, override: setupCase === 'override', ...urls });
      const body = pp.callsTo(/POST \/v2\/checkout\/orders$/)[0]!.body as { payment_source: { paypal: { attributes?: unknown } } };
      expect(body.payment_source.paypal.attributes).toBeUndefined();
    }
  });

  it('if the authorize response lacks the vault ID, it is read from the order', async () => {
    const pp = fakePayPal();
    const { store } = seededStore();
    const gate = new MoneyGate({ paypal: pp.client, store, now: () => NOW });
    const r = await gate.startApprovePurchase({ userId: USER, candidateId: 'cand-1', scanId: 'scan-hold', idempotencyKey: 'first-0002', ...urls });
    await gate.completeApproval(r.ok ? r.payment.id : '', USER);
    expect(pp.callsTo(/GET \/v2\/checkout\/orders/).length).toBeGreaterThanOrEqual(2); // approval check + vault lookup
  });
});
