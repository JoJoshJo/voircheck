import 'server-only';
import { drizzleGateStore, MoneyGate, PayPalClient, type GateStore } from '@voircheck/paypal';
import { getDb } from './db';

/** Created on first use at runtime (never at build time), sandbox only. */
let client: PayPalClient | null = null;
let store: GateStore | null = null;

export function getPayPal(): { paypal: PayPalClient; store: GateStore; gate: MoneyGate } {
  client ??= new PayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    baseUrl: process.env.PAYPAL_BASE_URL,
  });
  store ??= drizzleGateStore(getDb());
  return { paypal: client, store, gate: new MoneyGate({ paypal: client, store }) };
}
