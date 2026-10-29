import { vi } from 'vitest';
import { PayPalClient } from './client';
import { MemoryGateStore, type CandidateRow, type ScanRow, type Verdict } from './store';

/** Test-only fake of the PayPal sandbox API. Repeated PayPal-Request-Ids return the original result, like PayPal. */
export function fakePayPal(opts: { verifyStatus?: 'SUCCESS' | 'FAILURE'; vaultOnAuthorize?: string; authCreateTime?: string; captureStatus?: string; orderStatus?: string; slowMs?: number } = {}) {
  const byRequestId = new Map<string, unknown>();
  const calls: Array<{ method: string; path: string; body: unknown; requestId?: string }> = [];
  let orderSeq = 0;
  let tokenCalls = 0;

  const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status });

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const requestId = headers['paypal-request-id'];
    const body = init?.body && typeof init.body === 'string' && url.pathname !== '/v1/oauth2/token' ? JSON.parse(init.body) : undefined;
    const path = url.pathname;
    if (path === '/v1/oauth2/token' && String(init?.body).includes('response_type=client_token')) {
      calls.push({ method, path: '/v1/oauth2/token#client_token', body: String(init?.body) });
      return json(200, { access_token: 'browser-safe-token', expires_in: 900 });
    }
    if (path === '/v1/oauth2/token') {
      tokenCalls++;
      return json(200, { access_token: `tok_${tokenCalls}`, expires_in: 32400 });
    }
    calls.push({ method, path, body, requestId });
    if (requestId && byRequestId.has(requestId)) return json(200, byRequestId.get(requestId));
    // Like PayPal: a duplicate that arrives while the first is still in flight is NOT deduplicated.
    if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));

    let res: unknown;
    let m: RegExpMatchArray | null;
    if (method === 'POST' && path === '/v2/checkout/orders') {
      const id = `ORDER${++orderSeq}`;
      const b = body as { intent: string; payment_source: { paypal: { vault_id?: string } } };
      res = b.payment_source.paypal.vault_id
        ? { id, status: 'COMPLETED', intent: b.intent, purchase_units: [{ payments: { captures: [{ id: `CAP-${id}`, status: opts.captureStatus ?? 'COMPLETED' }] } }] }
        : { id, status: 'PAYER_ACTION_REQUIRED', intent: b.intent, links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
    } else if (method === 'GET' && (m = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/))) {
      res = { id: m[1], status: opts.orderStatus ?? 'APPROVED' };
    } else if (method === 'POST' && (m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/))) {
      res = {
        id: m[1],
        status: 'COMPLETED',
        purchase_units: [{ payments: { authorizations: [{ id: `AUTH-${m[1]}`, status: 'CREATED' }] } }],
        ...(opts.vaultOnAuthorize ? { payment_source: { paypal: { email_address: 'buyer@example.com', attributes: { vault: { id: opts.vaultOnAuthorize, status: 'VAULTED', customer: { id: 'CUST1' } } } } } } : {}),
      };
    } else if (method === 'GET' && (m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)$/))) {
      res = { id: m[1], status: 'CREATED', create_time: opts.authCreateTime ?? new Date().toISOString() };
    } else if (method === 'POST' && (m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/))) {
      res = { id: `CAP-${m[1]}`, status: opts.captureStatus ?? 'COMPLETED' };
    } else if (method === 'POST' && path.match(/^\/v2\/payments\/authorizations\/[^/]+\/void$/)) {
      res = null;
    } else if (method === 'POST' && (m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/reauthorize$/))) {
      res = { id: `RE-${m[1]}`, status: 'CREATED' };
    } else if (method === 'POST' && path === '/v3/vault/setup-tokens') {
      res = { id: `SETUP${++orderSeq}`, status: 'PAYER_ACTION_REQUIRED' };
    } else if (method === 'POST' && path === '/v3/vault/payment-tokens') {
      res = { id: `PTOKEN-${(body as { payment_source: { token: { id: string } } }).payment_source.token.id}`, customer: { id: 'CUST1' } };
    } else if (method === 'POST' && path === '/v1/notifications/verify-webhook-signature') {
      return json(200, { verification_status: opts.verifyStatus ?? 'SUCCESS' });
    } else {
      return json(404, { name: 'RESOURCE_NOT_FOUND' });
    }
    if (requestId) byRequestId.set(requestId, res);
    return json(res === null ? 204 : 201, res);
  });

  const client = new PayPalClient({ clientId: 'test-id', clientSecret: 'test-secret', fetch: fetchImpl as unknown as typeof fetch });
  const callsTo = (re: RegExp) => calls.filter((c) => re.test(`${c.method} ${c.path}`));
  return { client, calls, callsTo, fetchImpl, tokenCalls: () => tokenCalls };
}

export const USER = 'user-1';
export const OTHER_USER = 'user-2';
export const NOW = new Date('2026-10-28T12:00:00Z');

/** A memory store seeded with one candidate (Velbrook Supply, $59) and one scan per verdict. */
export function seededStore() {
  const store = new MemoryGateStore();
  const candidate: CandidateRow = {
    id: 'cand-1',
    sessionId: 'sess-1',
    userId: USER,
    storeName: 'Velbrook Supply',
    storeUrl: 'https://voircheck-stores.onrender.com/s/velbrook-supply',
    productTitle: 'Zephlet Buds',
    price: '59.00',
    currency: 'USD',
    source: 'demo',
  };
  store.candidates.set(candidate.id, candidate);
  const scan = (id: string, verdict: Verdict, expiresInMs = 3_600_000, url = `${candidate.storeUrl}/products/zephlet-buds`): ScanRow => ({
    id,
    url,
    verdict,
    riskScore: verdict === 'SAFE' ? 0 : verdict === 'HOLD' ? 40 : 80,
    scannedAt: new Date(NOW.getTime() - 60_000),
    cacheExpiresAt: new Date(NOW.getTime() + expiresInMs),
  });
  for (const s of [scan('scan-safe', 'SAFE'), scan('scan-hold', 'HOLD'), scan('scan-block', 'BLOCK'), scan('scan-stale', 'SAFE', -1), scan('scan-other-store', 'SAFE', 3_600_000, 'https://voircheck-stores.onrender.com/s/velbrook-outlet-deals')]) {
    store.scans.set(s.id, s);
  }
  store.profiles.set(USER, { userId: USER, autopayEnabled: true, autopayLimit: '100.00' });
  return { store, candidate };
}
