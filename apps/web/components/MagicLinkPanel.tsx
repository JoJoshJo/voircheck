'use client';

import { useEffect, useState } from 'react';
import { fmt, type Dict } from '../lib/i18n';
import { magicLinkRedirectUrls } from '../lib/oauth';
import { btnPrimary, input, label } from './ui';

export const RESEND_COOLDOWN_S = 60;

/**
 * "Email me a sign-in link" (Neon Auth magic link; emails go out via Resend SMTP from auth@mail.voircheck.com).
 * States: enter email → "Check your inbox" (with the address, "Use a different email", resend after 60 s).
 * `initialSentTo` / `initialCooldown` exist so the sent state can be rendered directly (tests).
 */
export function MagicLinkPanel({ t, initialSentTo = null, initialCooldown = 0 }: { t: Dict; initialSentTo?: string | null; initialCooldown?: number }) {
  const [email, setEmail] = useState(initialSentTo ?? '');
  const [sentTo, setSentTo] = useState<string | null>(initialSentTo);
  const [cooldown, setCooldown] = useState(initialCooldown);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function send(address: string) {
    setPending(true);
    setFailed(false);
    try {
      const { authClient } = await import('../lib/auth/client');
      const { error } = await authClient.signIn.magicLink({ email: address.trim(), ...magicLinkRedirectUrls(window.location.origin) });
      if (error) throw new Error(error.message);
      setSentTo(address.trim());
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="space-y-4 rounded-card border border-line p-5 text-center" role="status">
        <p className="text-[17px] font-medium">{t.auth.magicSentTitle}</p>
        <p className="text-[14px] leading-relaxed text-muted">{fmt(t.auth.magicSentBody, { email: sentTo })}</p>
        <div className="flex flex-col items-center gap-2">
          <button type="button" disabled={cooldown > 0 || pending} onClick={() => void send(sentTo)} className="text-[14px] text-ink underline underline-offset-4 disabled:text-faint disabled:no-underline">
            {cooldown > 0 ? fmt(t.auth.magicResendIn, { s: cooldown }) : pending ? t.auth.working : t.auth.magicResend}
          </button>
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setEmail('');
              setCooldown(0);
            }}
            className="text-[14px] text-muted underline underline-offset-4 hover:text-ink"
          >
            {t.auth.magicDifferent}
          </button>
        </div>
        {failed && <p className="text-[14px] text-muted">{t.auth.magicFailed}</p>}
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) void send(email);
      }}
    >
      <p className="text-[14px] text-muted">{t.auth.magicHint}</p>
      <div>
        <label htmlFor="magic-email" className={label}>
          {t.auth.email}
        </label>
        <input id="magic-email" name="magic-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </div>
      {failed && <p className="text-[14px] text-muted">{t.auth.magicFailed}</p>}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? t.auth.working : t.auth.magicSend}
      </button>
    </form>
  );
}
