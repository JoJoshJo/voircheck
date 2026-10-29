'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fmt, type Dict } from '../lib/i18n';
import { createPayPalInstance, newKey, postJson, type PayPalSession } from '../lib/paypal-sdk';
import type { PaymentView } from '../lib/payment-view';

type Phase = 'loading' | 'ready' | 'waiting' | 'working' | 'unavailable';

/** Auto-pay is requested at most once per result, even when React runs the effect twice (the server also locks). */
const autopayRequests = new Map<string, Promise<{ autopaid: boolean; reason?: string; payment?: PaymentView }>>();

/**
 * "Pay with PayPal" (JS SDK v6). The browser only ever sends IDs; MoneyGate decides capture/hold/void.
 * Approval is detected three ways: the SDK's onApprove, a "check again" button that asks the server (which asks
 * PayPal), and the CHECKOUT.ORDER.APPROVED webhook on the server.
 */
export function Checkout({
  t,
  lang,
  clientId,
  candidateId,
  scanId,
  autopay,
  override = false,
}: {
  t: Dict;
  lang: string;
  clientId: string;
  candidateId: string;
  scanId: string;
  autopay: boolean;
  override?: boolean;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const paymentId = useRef<string | null>(null);
  const key = useRef(newKey());
  const busy = useRef(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [note, setNote] = useState<string | null>(null);

  const goTo = (p: PaymentView) => router.push(`/app/pay/${p.id}`);
  const reason = (r: string | undefined) => (r && t.pay.reasons[r]) || r || '';

  useEffect(() => {
    let cancelled = false;
    let session: PayPalSession | null = null;

    async function setup() {
      // Auto-pay first (never with an override): SAFE + under the limit is charged with the saved wallet.
      if (autopay && !override) {
        setNote(t.pay.autopayRunning);
        const key = `auto-${scanId}-${candidateId}`;
        if (!autopayRequests.has(key)) {
          autopayRequests.set(key, postJson<{ autopaid: boolean; reason?: string; payment?: PaymentView }>('/api/pay/autopay', { candidateId, scanId, idempotencyKey: key }).then((r) => r.data));
        }
        const r = await autopayRequests.get(key)!;
        if (cancelled) return;
        if (r.autopaid && r.payment) return goTo(r.payment);
        // First purchase with Auto-pay on: the server adds "save this wallet" to the order (vault with purchase).
        setNote(r.reason === 'no saved PayPal wallet' ? t.pay.autopayFirstSave : fmt(t.pay.autopayFellBack, { reason: reason(r.reason) }));
      }
      try {
        const sdk = await createPayPalInstance(lang, clientId);
        const eligible = await sdk.findEligibleMethods({ currencyCode: 'USD' });
        if (cancelled) return;
        if (!eligible.isEligible('paypal')) return setPhase('unavailable');
        session = sdk.createPayPalOneTimePaymentSession({
          onApprove: async () => {
            if (!paymentId.current) return;
            setPhase('working');
            const r = await postJson<{ payment?: PaymentView }>('/api/pay/approve', { paymentId: paymentId.current });
            if (r.data.payment && r.data.payment.status !== 'created') return goTo(r.data.payment);
            setPhase('waiting');
            setNote(t.pay.notApprovedYet);
          },
          onCancel: async () => {
            if (!paymentId.current) return;
            const r = await postJson<{ payment?: PaymentView; approvedAfterAll?: boolean }>('/api/pay/cancel', { paymentId: paymentId.current });
            if (r.data.approvedAfterAll && r.data.payment) return goTo(r.data.payment);
            reset(t.pay.cancelled);
          },
          onError: () => reset(t.pay.error),
        });
        const button = document.createElement('paypal-button');
        button.setAttribute('type', 'pay');
        button.addEventListener('click', start);
        container.current?.replaceChildren(button);
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('unavailable');
      }
    }

    function reset(message: string) {
      busy.current = false;
      paymentId.current = null;
      key.current = newKey(); // a new attempt gets a new idempotency key
      setPhase('ready');
      setNote(message);
    }

    function start() {
      if (busy.current || !session) return; // double click: one order only
      busy.current = true;
      setNote(null);
      setPhase('waiting');
      // Not awaited before start(): the popup must open inside the click (transient activation).
      const order = postJson<{ paymentId?: string; orderId?: string; reason?: string }>('/api/pay/start', { candidateId, scanId, idempotencyKey: key.current, override }).then((r) => {
        if (!r.ok || !r.data.orderId || !r.data.paymentId) throw new Error(r.data.reason ?? 'start failed');
        paymentId.current = r.data.paymentId;
        return { orderId: r.data.orderId };
      });
      session.start({ presentationMode: 'auto' }, order).catch(() => reset(t.pay.error));
    }

    void setup();
    return () => {
      cancelled = true;
    };
  }, [candidateId, scanId, autopay, override, clientId]);

  async function checkAgain() {
    if (!paymentId.current) return;
    setPhase('working');
    const r = await postJson<{ payment?: PaymentView }>('/api/pay/status', { paymentId: paymentId.current });
    if (r.data.payment && r.data.payment.status !== 'created') return goTo(r.data.payment);
    setPhase('waiting');
    setNote(t.pay.notApprovedYet);
  }

  return (
    <div className="space-y-3">
      <div ref={container} className={phase === 'ready' || phase === 'waiting' ? 'max-w-sm' : 'hidden'} />
      {phase === 'loading' && <p className="text-[14px] text-muted">{t.pay.loadingPayPal}</p>}
      {phase === 'unavailable' && <p className="text-[14px] text-muted">{t.pay.paypalUnavailable}</p>}
      {phase === 'working' && <p className="text-[14px] text-muted">{t.pay.working}</p>}
      {phase === 'waiting' && (
        <div className="space-y-2">
          <p className="text-[14px] text-muted">{t.pay.waitingApproval}</p>
          <button type="button" onClick={checkAgain} className="text-[14px] text-ink underline underline-offset-4">
            {t.pay.checkStatus}
          </button>
        </div>
      )}
      {note && <p className="text-[14px] text-muted">{note}</p>}
      <p className="text-[12px] text-faint">{t.pay.sandboxNote}</p>
    </div>
  );
}
