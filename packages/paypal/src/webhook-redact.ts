/**
 * What we keep of a PayPal webhook event (Privacy page: "only payment status details"). A whitelist, so anything
 * PayPal adds later (payer name/email/address/phone, shipping, payment_source, customer…) is dropped by default.
 * Kept: event id/type/timestamps; resource ids, status, amounts, custom_id, related order/authorization ids,
 * the vault event's order id, and timestamps. Signature verification always runs on the original event.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick(src: unknown, keys: readonly string[]): Obj | undefined {
  if (!isObj(src)) return undefined;
  const out: Obj = {};
  for (const k of keys) if (k in src && src[k] !== undefined) out[k] = src[k] as Json;
  return Object.keys(out).length ? out : undefined;
}

const MONEY = ['currency_code', 'value'] as const;
const TIMES = ['create_time', 'update_time', 'expiration_time'] as const;
const PAYMENT_KEYS = ['id', 'status', 'custom_id', 'final_capture', ...TIMES] as const;

function payment(p: unknown): Obj | undefined {
  const base = pick(p, PAYMENT_KEYS);
  if (!base) return undefined;
  const amount = isObj(p) ? pick(p.amount, MONEY) : undefined;
  return amount ? { ...base, amount } : base;
}

function payments(list: unknown): Json[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out = list.map(payment).filter((x): x is Obj => !!x);
  return out.length ? out : undefined;
}

function purchaseUnit(u: unknown): Obj | undefined {
  if (!isObj(u)) return undefined;
  const out: Obj = { ...(pick(u, ['reference_id', 'custom_id']) ?? {}) };
  const amount = pick(u.amount, MONEY);
  if (amount) out.amount = amount;
  if (isObj(u.payments)) {
    const p: Obj = {};
    const auths = payments(u.payments.authorizations);
    const caps = payments(u.payments.captures);
    if (auths) p.authorizations = auths;
    if (caps) p.captures = caps;
    if (Object.keys(p).length) out.payments = p;
  }
  return Object.keys(out).length ? out : undefined;
}

export function redactWebhookPayload(event: unknown): Obj {
  if (!isObj(event)) return {};
  const out: Obj = { ...(pick(event, ['id', 'event_type', 'event_version', 'resource_type', 'resource_version', 'create_time']) ?? {}) };
  const r = event.resource;
  if (isObj(r)) {
    const res: Obj = { ...(pick(r, ['id', 'status', 'intent', 'custom_id', 'final_capture', ...TIMES]) ?? {}) };
    const amount = pick(r.amount, MONEY);
    if (amount) res.amount = amount;
    const related = isObj(r.supplementary_data) ? pick(r.supplementary_data.related_ids, ['order_id', 'authorization_id', 'capture_id']) : undefined;
    if (related) res.supplementary_data = { related_ids: related };
    const meta = pick(r.metadata, ['order_id']);
    if (meta) res.metadata = meta;
    if (Array.isArray(r.purchase_units)) {
      const units = r.purchase_units.map(purchaseUnit).filter((x): x is Obj => !!x);
      if (units.length) res.purchase_units = units;
    }
    out.resource = res;
  }
  return out;
}

/** Keys we treat as personal data when reporting what a redaction removes (names only, never values). */
export const PII_KEYS = ['payer', 'payment_source', 'shipping', 'customer', 'email_address', 'name', 'address', 'phone', 'phone_number', 'birth_date'] as const;

export function piiKeysPresent(payload: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(payload)) payload.forEach((x) => piiKeysPresent(x, found));
  else if (isObj(payload)) {
    for (const [k, v] of Object.entries(payload)) {
      if ((PII_KEYS as readonly string[]).includes(k)) found.add(k);
      piiKeysPresent(v, found);
    }
  }
  return found;
}
