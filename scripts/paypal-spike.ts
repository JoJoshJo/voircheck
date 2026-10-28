/**
 * VoirCheck — PayPal sandbox spike (spec 5.7).
 *
 * Proves which Orders v2 / Payments v2 behaviors work in sandbox before any UI is built.
 * Buyer approvals: the script prints each link and polls the order until it is APPROVED.
 * T6 opens a cloudflared quick tunnel and registers (then deletes) a temporary webhook via the API.
 * Sandbox only. Never prints tokens or secrets.
 *
 * Usage:
 *   pnpm spike            # run T1–T6
 *   pnpm spike T2 T3      # run selected tests (T1 always runs: it provides the token)
 *
 * Writes raw results (IDs + PayPal error names only) to scripts/spike-results.local.json (gitignored).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// ---------- config ----------

const REQUIRED = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_BASE_URL', 'PAYEE_A_EMAIL', 'PAYEE_B_EMAIL'] as const;
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')} (see .env.example)`);
  process.exit(1);
}
const BASE = process.env.PAYPAL_BASE_URL!.replace(/\/$/, '');
if (!BASE.includes('sandbox')) {
  console.error('PAYPAL_BASE_URL is not a sandbox URL. Refusing to run.');
  process.exit(1);
}
const PAYEE_A = process.env.PAYEE_A_EMAIL!;
const PAYEE_B = process.env.PAYEE_B_EMAIL!;
const RETURN_URL = 'https://example.com/voircheck/return';
const CANCEL_URL = 'https://example.com/voircheck/cancel';

// ---------- helpers ----------

type Result = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO';
interface TestRecord {
  id: string;
  name: string;
  result: Result;
  ids: Record<string, string>;
  notes: string[];
  error?: string;
}
const records: TestRecord[] = [];

let token = '';

class PayPalError extends Error {
  constructor(public status: number, public summary: string, public body: unknown) {
    super(summary);
  }
}

/** "NAME: message [issue: description] (debug_id X)" — PayPal error bodies only, never request auth. */
function summarizeError(status: number, body: any): string {
  if (!body || typeof body !== 'object') return `HTTP ${status}`;
  const name = body.name ?? body.error ?? `HTTP ${status}`;
  const message = body.message ?? body.error_description ?? '';
  const details = Array.isArray(body.details)
    ? body.details.map((d: any) => `${d.issue ?? ''}${d.description ? `: ${d.description}` : ''}`).join('; ')
    : '';
  const debug = body.debug_id ? ` (debug_id ${body.debug_id})` : '';
  return `HTTP ${status} ${name}${message ? `: ${message}` : ''}${details ? ` [${details}]` : ''}${debug}`;
}

async function api<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extraHeaders,
  };
  // Idempotency on every create/authorize/capture/void/reauthorize call.
  if (method === 'POST') headers['PayPal-Request-Id'] = randomUUID();
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? safeJson(text) : {};
  if (!res.ok) throw new PayPalError(res.status, summarizeError(res.status, json), json);
  return json as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

const errText = (e: unknown) => (e instanceof PayPalError ? e.summary : e instanceof Error ? e.message : String(e));

async function runTest(id: string, name: string, fn: (rec: TestRecord) => Promise<void>) {
  const rec: TestRecord = { id, name, result: 'FAIL', ids: {}, notes: [] };
  records.push(rec);
  console.log(`\n━━━ ${id}. ${name} ━━━`);
  try {
    await fn(rec);
  } catch (e) {
    rec.result = rec.result === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
    rec.error = errText(e);
  }
  console.log(`${id}: ${rec.result}${rec.error ? ` — ${rec.error}` : ''}`);
  for (const n of rec.notes) console.log(`   · ${n}`);
  for (const [k, v] of Object.entries(rec.ids)) console.log(`   ${k}: ${v}`);
}

function amount(value: string) {
  return { currency_code: 'USD', value };
}

function paypalSource(extra: Record<string, unknown> = {}) {
  return {
    paypal: {
      experience_context: {
        return_url: RETURN_URL,
        cancel_url: CANCEL_URL,
        shipping_preference: 'NO_SHIPPING',
        user_action: 'CONTINUE',
        brand_name: 'VoirCheck Spike',
      },
      ...extra,
    },
  };
}

async function createOrder(opts: { value: string; payeeEmail?: string; description: string; vault?: boolean }) {
  const unit: Record<string, unknown> = { amount: amount(opts.value), description: opts.description, custom_id: `spike-${Date.now()}` };
  if (opts.payeeEmail) unit.payee = { email_address: opts.payeeEmail };
  const vaultAttrs = opts.vault
    ? { attributes: { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' } } }
    : {};
  return api('POST', '/v2/checkout/orders', {
    intent: 'AUTHORIZE',
    purchase_units: [unit],
    payment_source: paypalSource(vaultAttrs),
  });
}

const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Prints the approval link, then polls the order until the buyer approves it (no keypress needed). */
async function waitForApproval(order: any, label: string) {
  const link = order.links?.find((l: any) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  if (!link) throw new Error(`No approval link on order ${order.id} (status ${order.status})`);
  console.log(`\n👉 ${label}`);
  console.log(`   Open this link, log in with the SANDBOX BUYER (personal) account, and approve:`);
  console.log(`   ${link}`);
  console.log(`   (After approving you'll land on example.com — that's expected.)`);
  console.log(`   Waiting for approval (polling every 3s, up to 10 min)…`);
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const after = await api('GET', `/v2/checkout/orders/${order.id}`);
    if (after.status === 'APPROVED') {
      console.log('   ✓ approved');
      return;
    }
    await sleep(3000);
  }
  throw new Error(`Order ${order.id} was not approved within 10 minutes`);
}

async function authorizeOrder(orderId: string) {
  const res = await api('POST', `/v2/checkout/orders/${orderId}/authorize`, {});
  const auth = res.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth?.id) throw new Error(`Authorize returned no authorization (order status ${res.status})`);
  return { res, auth };
}

/** Create → approve → authorize. Returns the order and authorization. */
async function approvedAuthorization(rec: TestRecord, opts: Parameters<typeof createOrder>[0]) {
  const order = await createOrder(opts);
  rec.ids.order_id = order.id;
  await waitForApproval(order, `Approve $${opts.value} order ${order.id}${opts.payeeEmail ? ` (payee ${opts.payeeEmail})` : ''}`);
  const { res, auth } = await authorizeOrder(order.id);
  rec.ids.authorization_id = auth.id;
  rec.notes.push(`authorization status ${auth.status}, expires ${auth.expiration_time ?? 'n/a'}`);
  return { order, authorizeRes: res, auth };
}

// ---------- tests ----------

async function t1() {
  await runTest('T1', 'OAuth access token', async (rec) => {
    const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const json: any = safeJson(await res.text());
    if (!res.ok || !json.access_token) throw new PayPalError(res.status, summarizeError(res.status, json), json);
    token = json.access_token; // kept in memory only
    rec.result = 'PASS';
    rec.notes.push(`token expires in ${Math.round(json.expires_in / 3600)}h`, `app_id ${json.app_id ?? 'n/a'}`);
    const vaultScope = typeof json.scope === 'string' && json.scope.includes('vault');
    rec.notes.push(`token scope mentions vault: ${vaultScope ? 'yes' : 'no'}`);
  });
}

async function t2() {
  await runTest('T2', 'AUTHORIZE + custom payee (store A) → capture', async (rec) => {
    const { order } = await approvedAuthorization(rec, { value: '23.00', payeeEmail: PAYEE_A, description: 'T2 spike — store A' });
    const capture = await api('POST', `/v2/payments/authorizations/${rec.ids.authorization_id}/capture`, { final_capture: true });
    rec.ids.capture_id = capture.id;
    rec.notes.push(`capture status ${capture.status}`);
    const after = await api('GET', `/v2/checkout/orders/${order.id}`);
    const payee = after.purchase_units?.[0]?.payee ?? {};
    const capturePayee = capture.payee?.email_address;
    rec.notes.push(`order payee ${payee.email_address ?? '?'} (merchant_id ${payee.merchant_id ?? '?'})${capturePayee ? `, capture payee ${capturePayee}` : ''}`);
    const payeeOk = (capturePayee ?? payee.email_address)?.toLowerCase() === PAYEE_A.toLowerCase();
    rec.result = capture.status === 'COMPLETED' && payeeOk ? 'PASS' : 'FAIL';
    if (!payeeOk) rec.error = 'Captured payee is not store A';
    else if (capture.status !== 'COMPLETED') rec.error = `Capture status ${capture.status}`;
  });
}

async function t3() {
  await runTest('T3', 'AUTHORIZE (store B) → VOID', async (rec) => {
    await approvedAuthorization(rec, { value: '59.00', payeeEmail: PAYEE_B, description: 'T3 spike — store B' });
    await api('POST', `/v2/payments/authorizations/${rec.ids.authorization_id}/void`, {});
    const auth = await api('GET', `/v2/payments/authorizations/${rec.ids.authorization_id}`);
    rec.notes.push(`authorization status after void: ${auth.status}`);
    rec.result = auth.status === 'VOIDED' ? 'PASS' : 'FAIL';
    if (auth.status !== 'VOIDED') rec.error = `Status ${auth.status}, expected VOIDED`;
  });
}

async function t3b() {
  await runTest('T3b', 'AUTHORIZE (app own account, NO payee) → VOID', async (rec) => {
    await approvedAuthorization(rec, { value: '59.00', description: 'T3b spike — own account' });
    await api('POST', `/v2/payments/authorizations/${rec.ids.authorization_id}/void`, {});
    const auth = await api('GET', `/v2/payments/authorizations/${rec.ids.authorization_id}`);
    rec.notes.push(`authorization status after void: ${auth.status}`);
    rec.result = auth.status === 'VOIDED' ? 'PASS' : 'FAIL';
    if (auth.status !== 'VOIDED') rec.error = `Status ${auth.status}, expected VOIDED`;
  });
}

async function t4() {
  await runTest('T4', 'REAUTHORIZE inside honor period', async (rec) => {
    await approvedAuthorization(rec, { value: '23.00', payeeEmail: PAYEE_A, description: 'T4 spike — reauthorize' });
    let toVoid = rec.ids.authorization_id;
    try {
      const re = await api('POST', `/v2/payments/authorizations/${rec.ids.authorization_id}/reauthorize`, { amount: amount('23.00') });
      rec.ids.reauthorization_id = re.id;
      toVoid = re.id;
      rec.result = 'PASS';
      rec.notes.push(`reauthorized: new id ${re.id}, status ${re.status}, expires ${re.expiration_time ?? 'n/a'}`);
    } catch (e) {
      // Either outcome is useful — record the exact rejection.
      rec.result = 'INFO';
      rec.error = `Rejected: ${errText(e)}`;
    }
    try {
      await api('POST', `/v2/payments/authorizations/${toVoid}/void`, {});
      rec.notes.push(`cleanup: voided ${toVoid}`);
    } catch (e) {
      rec.notes.push(`cleanup void failed: ${errText(e)}`);
    }
  });
}

async function t5() {
  let vaultId = '';
  await runTest('T5', 'VAULT on first payment, then charge vaulted wallet with NO approval', async (rec) => {
    let first;
    try {
      first = await approvedAuthorization(rec, { value: '12.00', description: 'T5 spike — vault setup', vault: true });
    } catch (e) {
      if (e instanceof PayPalError && /VAULT/i.test(e.summary)) rec.result = 'BLOCKED';
      throw e;
    }
    let vault = first.authorizeRes.payment_source?.paypal?.attributes?.vault;
    if (!vault?.id) {
      const order = await api('GET', `/v2/checkout/orders/${rec.ids.order_id}`);
      vault = order.payment_source?.paypal?.attributes?.vault;
    }
    rec.notes.push(`vault status ${vault?.status ?? 'none'}`);
    if (!vault?.id) throw new Error(`No vault ID returned (vault status ${vault?.status ?? 'absent'}) — is Vault enabled in Sandbox App Settings?`);
    vaultId = vault.id;
    rec.ids.vault_id = vault.id;
    if (vault.customer?.id) rec.ids.vault_customer_id = vault.customer.id;

    // Second order: vault_id, no buyer approval.
    const second = await api('POST', '/v2/checkout/orders', {
      intent: 'AUTHORIZE',
      purchase_units: [{ amount: amount('9.00'), description: 'T5 spike — vaulted charge', custom_id: `spike-${Date.now()}` }],
      payment_source: { paypal: { vault_id: vaultId } },
    });
    rec.ids.second_order_id = second.id;
    rec.notes.push(`second order status on create: ${second.status}`);
    let auth = second.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth && second.status === 'APPROVED') auth = (await authorizeOrder(second.id)).auth;
    if (!auth) throw new Error(`Second order needs buyer action (status ${second.status}) — vaulted charge did not work off-session`);
    rec.ids.second_authorization_id = auth.id;
    rec.notes.push(`second authorization status ${auth.status}`);
    rec.result = ['CREATED', 'CAPTURED', 'PENDING'].includes(auth.status) ? 'PASS' : 'FAIL';
    if (rec.result === 'FAIL') rec.error = `Second authorization status ${auth.status}`;
  });

  if (!vaultId) return;
  await runTest('T5b', 'Vaulted charge WITH custom payee (store A), no approval', async (rec) => {
    const order = await api('POST', '/v2/checkout/orders', {
      intent: 'AUTHORIZE',
      purchase_units: [{ amount: amount('7.00'), payee: { email_address: PAYEE_A }, description: 'T5b spike — vaulted + payee', custom_id: `spike-${Date.now()}` }],
      payment_source: { paypal: { vault_id: vaultId } },
    });
    rec.ids.order_id = order.id;
    let auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth && order.status === 'APPROVED') auth = (await authorizeOrder(order.id)).auth;
    if (!auth) throw new Error(`Needs buyer action (status ${order.status})`);
    rec.ids.authorization_id = auth.id;
    rec.notes.push(`authorization status ${auth.status}`);
    rec.result = 'PASS';
  });
}

// ---------- T6 webhooks ----------

interface Received {
  headers: IncomingHttpHeaders;
  body: any;
}

async function startTunnel(port: number): Promise<{ url: string; proc: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
    const timer = setTimeout(() => reject(new Error('cloudflared did not print a tunnel URL within 30s')), 30_000);
    const onData = (buf: Buffer) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], proc });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared not available: ${e.message}`));
    });
  });
}

async function t6() {
  await runTest('T6', 'Webhook delivery + signature verification', async (rec) => {
    const received: Received[] = [];
    const port = 8787;
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        if (req.method === 'POST') {
          const body = safeJson(data);
          received.push({ headers: req.headers, body });
          console.log(`   ⇢ webhook received: ${body.event_type ?? '?'} (${body.id ?? '?'})`);
        }
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(port, r));

    let tunnel: { url: string; proc: ChildProcess } | undefined;
    let webhookId = '';
    try {
      try {
        tunnel = await startTunnel(port);
      } catch (e) {
        rec.result = 'BLOCKED';
        throw e;
      }
      const hookUrl = `${tunnel.url}/webhooks/paypal`;
      // The quick-tunnel URL changes every run, so register a temporary webhook via the API
      // (same as Dashboard → Webhooks → Add Webhook) and delete it afterwards.
      const hook = await api('POST', '/v1/notifications/webhooks', {
        url: hookUrl,
        event_types: ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.AUTHORIZATION.CREATED', 'PAYMENT.AUTHORIZATION.VOIDED'].map((name) => ({ name })),
      });
      webhookId = hook.id;
      rec.ids.webhook_id = hook.id;
      rec.notes.push(`temporary webhook registered for ${hookUrl}`);
      await sleep(5000); // let the tunnel's DNS settle before PayPal delivers

      // Trigger real events: approve → authorize → void.
      await approvedAuthorization(rec, { value: '5.00', description: 'T6 spike — webhook trigger' });
      await api('POST', `/v2/payments/authorizations/${rec.ids.authorization_id}/void`, {});

      console.log('   Waiting up to 90s for webhook deliveries…');
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && received.length < 3) await new Promise((r) => setTimeout(r, 2000));
      if (!received.length) throw new Error('No webhook delivered within 90s');

      let verified = 0;
      for (const ev of received) {
        const h = ev.headers;
        const v = await api('POST', '/v1/notifications/verify-webhook-signature', {
          auth_algo: h['paypal-auth-algo'],
          cert_url: h['paypal-cert-url'],
          transmission_id: h['paypal-transmission-id'],
          transmission_sig: h['paypal-transmission-sig'],
          transmission_time: h['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: ev.body,
        });
        rec.notes.push(`${ev.body.event_type}: verification ${v.verification_status}`);
        if (v.verification_status === 'SUCCESS') verified++;
      }
      rec.result = verified === received.length ? 'PASS' : 'FAIL';
      if (rec.result === 'FAIL') rec.error = `${verified}/${received.length} events verified`;
    } finally {
      if (webhookId) await api('DELETE', `/v1/notifications/webhooks/${webhookId}`).catch((e) => rec.notes.push(`webhook cleanup failed: ${errText(e)}`));
      tunnel?.proc.kill();
      server.close();
    }
  });
}

// ---------- main ----------

const ALL: Record<string, () => Promise<void>> = { T2: t2, T3: t3, T4: t4, T3B: t3b, T5: t5, T6: t6 };

async function main() {
  const selected = process.argv.slice(2).map((s) => s.toUpperCase());
  await t1();
  if (!token) {
    console.log('\nNo token — remaining tests skipped.');
  } else {
    for (const [id, fn] of Object.entries(ALL)) if (!selected.length || selected.includes(id)) await fn();
  }

  console.log('\n━━━ SUMMARY ━━━');
  for (const r of records) console.log(`${r.id.padEnd(4)} ${r.result.padEnd(8)} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  // Merge with earlier runs so partial reruns (e.g. `pnpm spike T5`) keep previous results.
  const outFile = new URL('./spike-results.local.json', import.meta.url);
  const previous: TestRecord[] = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')).records ?? [] : [];
  const merged = [...previous.filter((p) => !records.some((r) => r.id === p.id)), ...records];
  writeFileSync(outFile, JSON.stringify({ updatedAt: new Date().toISOString(), records: merged }, null, 2));
  console.log('\nRaw results: scripts/spike-results.local.json');
}

main().catch((e) => {
  console.error(errText(e));
  process.exit(1);
});
