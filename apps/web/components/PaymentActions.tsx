'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fmt, type Dict } from '../lib/i18n';
import { postJson } from '../lib/paypal-sdk';
import type { PaymentView } from '../lib/payment-view';
import { Checkout } from './Checkout';
import { btnPrimary, btnSecondary } from './ui';

function left(t: Dict, iso: string, now: number): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${fmt(t.pay.days, { n: d })} ${fmt(t.pay.hours, { n: h })}` : h > 0 ? `${fmt(t.pay.hours, { n: h })} ${fmt(t.pay.minutes, { n: m })}` : fmt(t.pay.minutes, { n: Math.max(1, m) });
}

/** HOLD screen actions: countdowns + Capture / Void, and Reauthorize only from day 4 (once). */
export function HoldActions({ t, payment }: { t: Dict; payment: PaymentView }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!payment.hold) return null;
  const honorLeft = left(t, payment.hold.honorEndsAt, now);
  const expiresLeft = left(t, payment.hold.expiresAt, now);

  async function act(action: 'capture' | 'void' | 'reauthorize') {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ payment?: PaymentView }>(`/api/pay/${action}`, { paymentId: payment.id });
    setBusy(false);
    if (!r.ok) return setError(t.pay.error);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-[14px] text-muted">
        <p>{honorLeft ? fmt(t.pay.honorEnds, { left: honorLeft }) : t.pay.honorOver}</p>
        {expiresLeft && <p>{fmt(t.pay.expiresIn, { left: expiresLeft })}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => act('capture')}>
          {t.pay.capture}
        </button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => act('void')}>
          {t.pay.void}
        </button>
        {payment.hold.canReauthorize && (
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => act('reauthorize')}>
            {t.pay.reauthorize}
          </button>
        )}
      </div>
      {!payment.hold.canReauthorize && <p className="text-[12px] text-faint">{t.pay.reauthorizeNote}</p>}
      {error && <p className="text-[14px] text-muted">{error}</p>}
    </div>
  );
}

/** BLOCK: small secondary "Pay anyway" link → strong warning + checkbox → a new PayPal approval with the override. */
export function PayAnyway({ t, lang, candidateId, scanId }: { t: Dict; lang: string; candidateId: string; scanId: string }) {
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [go, setGo] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-muted underline underline-offset-4 hover:text-ink">
        {t.pay.payAnyway}
      </button>
    );
  return (
    <div className="rounded-card border border-block/30 bg-block-bg p-5 text-block">
      <p className="text-[16px] font-medium">{t.pay.payAnywayTitle}</p>
      <p className="mt-2 text-[14px] leading-relaxed">{t.pay.payAnywayBody}</p>
      {!go ? (
        <>
          <label className="mt-4 flex items-center gap-3 text-[14px] font-medium">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-4 w-4 accent-[#791F1F]" />
            {t.pay.understand}
          </label>
          <button type="button" disabled={!agreed} onClick={() => setGo(true)} className={`${btnSecondary} mt-4`}>
            {t.pay.payAnywayGo}
          </button>
        </>
      ) : (
        <div className="mt-4 rounded-control bg-white p-4 text-ink">
          <Checkout t={t} lang={lang} candidateId={candidateId} scanId={scanId} autopay={false} override />
        </div>
      )}
    </div>
  );
}

export function ShareLink({ t, path }: { t: Dict; path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={btnSecondary}
      onClick={async () => {
        await navigator.clipboard.writeText(new URL(path, window.location.origin).href).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? t.receipt.copied : t.receipt.share}
    </button>
  );
}

/** Payment still waiting for PayPal approval (e.g. the page was reloaded mid-checkout). */
export function AwaitApproval({ t, paymentId }: { t: Dict; paymentId: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={btnSecondary}
        onClick={async () => {
          const r = await postJson<{ payment?: PaymentView }>('/api/pay/status', { paymentId });
          if (r.data.payment && r.data.payment.status !== 'created') router.refresh();
          else setNote(t.pay.notApprovedYet);
        }}
      >
        {t.pay.checkStatus}
      </button>
      {note && <p className="text-[14px] text-muted">{note}</p>}
    </div>
  );
}
