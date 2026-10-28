/**
 * Sandbox integration check for packages/paypal, through the real MoneyGate (in-memory DB rows).
 *   pnpm paypal-check
 * 1. Approve mode, BLOCK store: create AUTHORIZE order → you approve in the browser (polled) → authorize → gate voids.
 * 2. Auto-pay, SAFE store: direct CAPTURE with the saved wallet from the spike (T5), if one exists locally.
 * Sandbox only. Prints IDs and statuses only: no credentials, tokens or saved-wallet IDs.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getOrder, MemoryGateStore, MoneyGate, PayPalClient } from '@voircheck/paypal';

const USER = '00000000-0000-4000-8000-00000000c0de';
const BASE = 'https://voircheck-stores.onrender.com/s';
const now = Date.now();

const paypal = new PayPalClient({ clientId: process.env.PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '', baseUrl: process.env.PAYPAL_BASE_URL });
const store = new MemoryGateStore();
const gate = new MoneyGate({ paypal, store });

const seed = (id: string, slug: string, name: string, price: string, verdict: 'SAFE' | 'BLOCK') => {
  store.candidates.set(id, { id, sessionId: 'check-session', userId: USER, storeName: name, storeUrl: `${BASE}/${slug}`, productTitle: 'Zephlet Buds', price, currency: 'USD', source: 'demo' });
  store.scans.set(`scan-${id}`, { id: `scan-${id}`, url: `${BASE}/${slug}/products/zephlet-buds`, verdict, riskScore: verdict === 'SAFE' ? 0 : 70, scannedAt: new Date(now), cacheExpiresAt: new Date(now + 3_600_000) });
};
seed('cand-block', 'velbrook-outlet-deals', 'Velbrook-Outlet Deals', '23.00', 'BLOCK');
seed('cand-safe', 'velbrook-supply', 'Velbrook Supply', '59.00', 'SAFE');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const show = (label: string, o: object) => console.log(`${label}: ${JSON.stringify(o)}`);

// ---------- 1. approve mode → BLOCK → void ----------
console.log('\n=== 1. Approve mode, BLOCK store (Velbrook-Outlet Deals, $23.00) ===');
// --order <id>: continue with an order created (and approved) by an earlier run, instead of creating a new one.
const resumeOrder = process.argv.includes('--order') ? process.argv[process.argv.indexOf('--order') + 1] : undefined;
const started = resumeOrder
  ? {
      ok: true as const,
      approvalUrl: null,
      payment: await store.insertPayment({
        userId: USER,
        sessionId: 'check-session',
        candidateId: 'cand-block',
        scanId: 'scan-cand-block',
        paypalOrderId: resumeOrder,
        authorizationId: null,
        captureId: null,
        storeSlug: 'velbrook-outlet-deals',
        amount: '23.00',
        currency: 'USD',
        status: 'created',
        mode: 'approve',
        overrideUsed: false,
      }),
    }
  : await gate.startApprovePurchase({
      userId: USER,
      candidateId: 'cand-block',
      scanId: 'scan-cand-block',
      idempotencyKey: `check-${now}`,
      returnUrl: 'https://example.com/voircheck/return',
      cancelUrl: 'https://example.com/voircheck/cancel',
    });
if (!started.ok) throw new Error(started.reason);
show('order', { orderId: started.payment.paypalOrderId, status: started.payment.status, amount: started.payment.amount, custom_id: started.payment.storeSlug, resumed: !!resumeOrder });
if (started.approvalUrl) console.log(`\nApprove with the SANDBOX BUYER account (you'll land on example.com afterwards):\n${started.approvalUrl}\n`);
console.log('Waiting for approval (polling every 3s, up to 10 min)...');
const deadline = Date.now() + 10 * 60_000;
for (;;) {
  const o = await getOrder(paypal, started.payment.paypalOrderId);
  if (o.status === 'APPROVED') break;
  if (Date.now() > deadline) throw new Error(`order not approved in 10 minutes (status ${o.status})`);
  await sleep(3000);
}
console.log('approved');
const settled = await gate.completeApproval(started.payment.id, USER, 'user');
if (!settled.ok) throw new Error(settled.reason);
const auth = await paypal.request<{ id: string; status: string }>('GET', `/v2/payments/authorizations/${settled.payment.authorizationId}`);
show('gate result', { paymentStatus: settled.payment.status, authorizationId: auth.id, paypalAuthorizationStatus: auth.status });

// ---------- 2. auto-pay → SAFE → direct CAPTURE ----------
console.log('\n=== 2. Auto-pay, SAFE store (Velbrook Supply, $59.00, limit $100) ===');
let vaultId = process.env.PAYPAL_VAULT_ID;
if (!vaultId) {
  try {
    const local = JSON.parse(readFileSync(new URL('./spike-results.local.json', import.meta.url), 'utf8')) as { records: Array<{ id: string; ids: Record<string, string> }> };
    vaultId = local.records.find((r) => r.ids.vault_id)?.ids.vault_id;
  } catch {
    vaultId = undefined;
  }
}
if (!vaultId) {
  console.log('skipped: no saved wallet from the spike found locally');
} else {
  store.profiles.set(USER, { userId: USER, autopayEnabled: true, autopayLimit: '100.00' });
  await store.saveVaultToken(USER, vaultId, 'VAULTED');
  const auto = await gate.autoPay({ userId: USER, candidateId: 'cand-safe', scanId: 'scan-cand-safe', idempotencyKey: `check-${now}` });
  if (!auto.ok) show('auto-pay refused', { reason: auto.reason });
  else show('auto-pay', { orderId: auto.payment.paypalOrderId, captureId: auto.payment.captureId, status: auto.payment.status, amount: auto.payment.amount, custom_id: auto.payment.storeSlug });

  const refused = await gate.autoPay({ userId: USER, candidateId: 'cand-block', scanId: 'scan-cand-block', idempotencyKey: `check-${now}-b`, override: true });
  show('auto-pay on BLOCK store with override (must be refused, no PayPal call)', refused.ok ? { unexpected: 'allowed' } : { reason: refused.reason });
}

console.log('\naudit log:');
for (const a of store.audit) console.log(`  ${a.actor.padEnd(6)} ${a.action}`);
