'use client';

/**
 * PayPal JS SDK v6 (sandbox). Loaded once per page; initialized with a browser-safe client token from our server
 * (never the client secret). Minimal types for the parts we use.
 */
export const PAYPAL_SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';

export interface PayPalSession {
  start(options: { presentationMode: 'auto' | 'popup' | 'modal' }, input: Promise<{ orderId: string } | { setupToken: string }>): Promise<void>;
}
export interface PayPalSdkInstance {
  findEligibleMethods(options?: { currencyCode?: string; paymentFlow?: string }): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(handlers: SessionHandlers<{ orderId: string }>): PayPalSession;
  createPayPalSavePaymentSession(handlers: SessionHandlers<{ vaultSetupToken: string }>): PayPalSession;
}
interface SessionHandlers<A> {
  onApprove(data: A): Promise<void> | void;
  onCancel(data?: unknown): void;
  onError(err: unknown): void;
}
declare global {
  interface Window {
    paypal?: { createInstance(options: { clientToken: string; components: string[]; pageType?: string; locale?: string }): Promise<PayPalSdkInstance> };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.paypal) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PAYPAL_SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('PayPal SDK failed to load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

export async function createPayPalInstance(lang: string): Promise<PayPalSdkInstance> {
  const [, token] = await Promise.all([loadScript(), postJson<{ clientToken?: string }>('/api/pay/client-token', {})]);
  if (!window.paypal || !token.data.clientToken) throw new Error('PayPal unavailable');
  return window.paypal.createInstance({ clientToken: token.data.clientToken, components: ['paypal-payments'], pageType: 'checkout', locale: lang === 'fr' ? 'fr-FR' : 'en-US' });
}

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
