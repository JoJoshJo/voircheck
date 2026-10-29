'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dict } from '../lib/i18n';
import { createPayPalInstance, postJson } from '../lib/paypal-sdk';

/** One-time PayPal approval that saves the wallet for Auto-pay (no purchase). Only the token ID is kept server-side. */
export function WalletSetup({ t, lang, hasWallet }: { t: Dict; lang: string; hasWallet: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'ready' | 'saved' | 'failed' | 'unavailable'>(hasWallet ? 'saved' : 'idle');

  useEffect(() => {
    if (hasWallet) return;
    let cancelled = false;
    (async () => {
      try {
        const sdk = await createPayPalInstance(lang);
        const eligible = await sdk.findEligibleMethods({ currencyCode: 'USD', paymentFlow: 'VAULT_WITHOUT_PAYMENT' });
        if (cancelled) return;
        if (!eligible.isEligible('paypal')) return setState('unavailable');
        const session = sdk.createPayPalSavePaymentSession({
          onApprove: async (data) => {
            const r = await postJson('/api/pay/wallet-confirm', { setupTokenId: data.vaultSetupToken });
            setState(r.ok ? 'saved' : 'failed');
          },
          onCancel: () => setState('ready'),
          onError: () => setState('failed'),
        });
        const button = document.createElement('paypal-button');
        button.addEventListener('click', () => {
          const token = postJson<{ setupToken?: string }>('/api/pay/wallet-setup', {}).then((r) => {
            if (!r.data.setupToken) throw new Error('setup failed');
            return { setupToken: r.data.setupToken };
          });
          session.start({ presentationMode: 'auto' }, token).catch(() => setState('failed'));
        });
        container.current?.replaceChildren(button);
        setState('ready');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasWallet, lang]);

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-muted">{state === 'saved' ? t.wallet.saved : t.wallet.missing}</p>
      {state !== 'saved' && <div ref={container} className="max-w-xs" />}
      {state === 'failed' && <p className="text-[14px] text-muted">{t.wallet.failed}</p>}
      {state === 'unavailable' && <p className="text-[14px] text-muted">{t.pay.paypalUnavailable}</p>}
    </div>
  );
}
