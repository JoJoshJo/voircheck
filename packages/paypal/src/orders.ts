import type { PayPalClient } from './client';

/**
 * Typed Orders v2 / Payments v2 wrappers. No `payee` field anywhere: every payment goes to the app's own merchant
 * (spike T3: void to a third-party payee → PERMISSION_DENIED). Store identity rides in purchase_units[0].custom_id
 * (store slug) and description (store name).
 *
 * captureAuthorization and chargeVaultedWallet move money: only the money gate (gate.ts) calls them, and they are
 * not exported from the package index.
 */

export type OrderStatus = 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface Authorization {
  id: string;
  status: string;
  expiration_time?: string;
  create_time?: string;
}

export interface Capture {
  id: string;
  status: string;
}

export interface VaultAttributes {
  id?: string;
  status?: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  intent?: 'AUTHORIZE' | 'CAPTURE';
  links?: PayPalLink[];
  payment_source?: { paypal?: { attributes?: { vault?: VaultAttributes } } };
  purchase_units?: Array<{
    custom_id?: string;
    description?: string;
    amount?: { currency_code: string; value: string };
    payments?: { authorizations?: Authorization[]; captures?: Capture[] };
  }>;
}

export interface Money {
  /** Decimal string with 2 places, e.g. "59.00". */
  value: string;
  currency: string;
}

export interface CreateOrderInput {
  intent: 'AUTHORIZE' | 'CAPTURE';
  amount: Money;
  storeSlug: string;
  storeName: string;
  /** Buyer-approved orders need return/cancel URLs; vaulted charges don't. */
  returnUrl?: string;
  cancelUrl?: string;
  /** Save the buyer's PayPal wallet on first approval (auto-pay setup). */
  vaultOnSuccess?: boolean;
  /** Charge a saved wallet: no buyer approval step (spike T5/T5c). */
  vaultId?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,126}$/;

export function toMoney(amount: number | string, currency: string): Money {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be a positive number');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be an ISO 4217 code');
  return { value: n.toFixed(2), currency };
}

export function orderBody(input: CreateOrderInput): Record<string, unknown> {
  if (!SLUG_RE.test(input.storeSlug)) throw new Error('storeSlug must be a lowercase slug (max 127 chars)');
  const unit = {
    amount: { currency_code: input.amount.currency, value: input.amount.value },
    custom_id: input.storeSlug,
    description: input.storeName.slice(0, 127),
  };
  const paypal: Record<string, unknown> = input.vaultId
    ? { vault_id: input.vaultId }
    : {
        experience_context: {
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          shipping_preference: 'NO_SHIPPING',
          user_action: 'CONTINUE',
          brand_name: 'VoirCheck',
        },
        ...(input.vaultOnSuccess ? { attributes: { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' } } } : {}),
      };
  if (!input.vaultId && (!input.returnUrl || !input.cancelUrl)) throw new Error('buyer-approved orders need returnUrl and cancelUrl');
  return { intent: input.intent, purchase_units: [unit], payment_source: { paypal } };
}

export const createOrder = (c: PayPalClient, input: CreateOrderInput, requestId: string) =>
  c.request<Order>('POST', '/v2/checkout/orders', { body: orderBody(input), requestId });

export const getOrder = (c: PayPalClient, orderId: string) => c.request<Order>('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);

export const authorizeOrder = (c: PayPalClient, orderId: string, requestId: string) =>
  c.request<Order>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { body: {}, requestId });

/** Money moves. Gate only. */
export const captureAuthorization = (c: PayPalClient, authorizationId: string, requestId: string) =>
  c.request<Capture>('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, { body: { final_capture: true }, requestId });

export const voidAuthorization = (c: PayPalClient, authorizationId: string, requestId: string) =>
  c.request<null>('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, { body: {}, requestId });

export const reauthorizeAuthorization = (c: PayPalClient, authorizationId: string, requestId: string) =>
  c.request<Authorization>('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`, { body: {}, requestId });

/** Money moves. Gate only. Direct CAPTURE with a saved wallet, no buyer step (spike T5c). */
export const chargeVaultedWallet = (c: PayPalClient, input: Omit<CreateOrderInput, 'intent' | 'returnUrl' | 'cancelUrl' | 'vaultOnSuccess'> & { vaultId: string }, requestId: string) =>
  createOrder(c, { ...input, intent: 'CAPTURE' }, requestId);

export const firstAuthorization = (o: Order) => o.purchase_units?.[0]?.payments?.authorizations?.[0] ?? null;
export const firstCapture = (o: Order) => o.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
export const approvalLink = (o: Order) => o.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;

// ---------- save a PayPal wallet without a purchase (Payment Method Tokens v3) ----------

export interface SetupToken {
  id: string;
  status: string;
  links?: PayPalLink[];
}

export const createVaultSetupToken = (c: PayPalClient, input: { returnUrl: string; cancelUrl: string }, requestId: string) =>
  c.request<SetupToken>('POST', '/v3/vault/setup-tokens', {
    body: {
      payment_source: {
        paypal: {
          usage_type: 'MERCHANT',
          customer_type: 'CONSUMER',
          permit_multiple_payment_tokens: false,
          experience_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl, vault_instruction: 'ON_PAYER_APPROVAL', brand_name: 'VoirCheck' },
        },
      },
    },
    requestId,
  });

/** Turns an approved setup token into a long-lived payment token; only its ID is ever stored. */
export const createVaultPaymentToken = (c: PayPalClient, setupTokenId: string, requestId: string) =>
  c.request<{ id: string }>('POST', '/v3/vault/payment-tokens', { body: { payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } }, requestId });
