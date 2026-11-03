'use client';

import { useState } from 'react';
import { fmt, type Dict } from '../lib/i18n';
import { btnPrimary, btnSecondary } from './ui';

/**
 * The person's own "Request refund" (spec 5.7, Nov 3): POST /api/pay/refund → MoneyGate.userRefund, which checks
 * ownership, status and PayPal's window, and refunds once. Used by the agent's chat card (the click IS the
 * confirmation of the agent's proposal) and by History (`confirmFirst`: a second tap confirms). Never on the public
 * receipt page.
 */
/** PayPal answers a refund in a few seconds; past this we stop the spinner (the refund itself may still finish). */
export const REFUND_TIMEOUT_MS = 25_000;

export function RefundButton({ t, paymentId, refLabel, amount, status, confirmFirst = false, onStatus }: { t: Dict; paymentId: string; refLabel: string; amount: string; status: string; confirmFirst?: boolean; onStatus?: (status: string) => void }) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'working' | 'failed' | 'slow'>('idle');
  // What the refund call returned, until the parent (if any) passes the new status down.
  const [result, setResult] = useState<string | null>(null);
  const shown = status === 'refunded' ? status : (result ?? status);

  if (shown === 'refunded') return <p className="text-[13px] font-medium">{fmt(t.refund.done, { amount })}</p>;
  if (shown === 'refund_pending') return <p className="text-[13px] font-medium">{t.refund.pending}</p>;
  if (shown !== 'captured') return null;

  async function refund() {
    setPhase('working');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFUND_TIMEOUT_MS);
    try {
      const res = await fetch('/api/pay/refund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentId }), signal: controller.signal });
      const body = (await res.json().catch(() => null)) as { payment?: { status?: string } } | null;
      const next = res.ok ? body?.payment?.status : undefined;
      if (next === 'refunded' || next === 'refund_pending') {
        setResult(next);
        onStatus?.(next);
        setPhase('idle');
      } else setPhase('failed');
    } catch {
      // Timed out: the server may still finish the refund (MoneyGate refunds a payment once), so don't say it failed.
      setPhase(controller.signal.aborted ? 'slow' : 'failed');
    } finally {
      clearTimeout(timer);
    }
  }

  if (phase === 'slow') return <p className="text-[13px] text-muted">{t.refund.slow}</p>;

  if (phase === 'confirm') {
    return (
      <div className="space-y-2">
        <p className="text-[13px]">{fmt(t.refund.confirm, { amount, ref: refLabel })}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={() => void refund()}>
            {t.refund.confirmButton}
          </button>
          <button type="button" className={btnSecondary} onClick={() => setPhase('idle')}>
            {t.refund.cancel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button type="button" className={confirmFirst ? btnSecondary : btnPrimary} disabled={phase === 'working'} onClick={() => (confirmFirst ? setPhase('confirm') : void refund())}>
        {phase === 'working' ? t.refund.working : confirmFirst ? t.refund.buttonShort : fmt(t.refund.button, { ref: refLabel, amount })}
      </button>
      {phase === 'failed' && <p className="text-[13px] text-muted">{t.refund.failed}</p>}
    </div>
  );
}
