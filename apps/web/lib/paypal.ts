import 'server-only';
import { toolkitRefunder } from '@voircheck/agent';
import { drizzleGateStore, MoneyGate, PayPalClient, type GateStore, type Refunder } from '@voircheck/paypal';
import { getDb } from './db';

/** Created on first use at runtime (never at build time), sandbox only. */
let client: PayPalClient | null = null;
let store: GateStore | null = null;
let refunder: Refunder | null = null;

export function getPayPal(): { paypal: PayPalClient; store: GateStore; gate: MoneyGate } {
  client ??= new PayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    baseUrl: process.env.PAYPAL_BASE_URL,
  });
  store ??= drizzleGateStore(getDb());
  // Refunds go through the PayPal Agent Toolkit's create_refund (sandbox forced), run by MoneyGate only.
  refunder ??= toolkitRefunder({ clientId: process.env.PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '' });
  return { paypal: client, store, gate: new MoneyGate({ paypal: client, store, refunder }) };
}
