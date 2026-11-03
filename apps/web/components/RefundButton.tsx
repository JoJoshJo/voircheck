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
export function RefundButton({ t, paymentId, refLabel, amount, status, confirmFirst = false, onStatus }: { t: Dict; paymentId: string; refLabel: string; amount: string; status: string; confirmFirst?: boolean; onStatus?: (status: string) => void }) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'working' | 'failed'>('idle');

  if (status === 'refunded') return <p className="text-[13px] font-medium">{fmt(t.refund.done, { amount })}</p>;
  if (status === 'refund_pending') return <p className="text-[13px] font-medium">{t.refund.pending}</p>;
  if (status !== 'captured') return null;

  async function refund() {
    setPhase('working');
    try {
      const res = await fetch('/api/pay/refund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentId }) });
      const body = (await res.json().catch(() => null)) as { payment?: { status?: string } } | null;
      const next = res.ok ? body?.payment?.status : undefined;
      if (next === 'refunded' || next === 'refund_pending') {
        onStatus?.(next);
        setPhase('idle');
      } else setPhase('failed');
    } catch {
      setPhase('failed');
    }
  }

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
