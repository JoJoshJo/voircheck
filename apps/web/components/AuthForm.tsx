'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { Dict } from '../lib/i18n';
import { GoogleButton } from './GoogleButton';
import { MagicLinkPanel } from './MagicLinkPanel';
import { btnPrimary, input, label } from './ui';

type Action = (prev: { error: boolean } | null, form: FormData) => Promise<{ error: boolean }>;
export type AuthError = 'oauth' | 'link_expired' | 'link_other_browser' | null;

/**
 * Sign-in / sign-up: Google, then email with a password, or "Email me a sign-in link" (magic link).
 * The password form and the magic-link panel are siblings (never nested forms); a link switches between them.
 */
export function AuthForm({
  mode,
  action,
  t,
  authError = null,
  initialMethod = 'password',
}: {
  mode: 'sign-in' | 'sign-up';
  action: Action;
  t: Dict;
  authError?: AuthError;
  initialMethod?: 'password' | 'link';
}) {
  const [state, formAction, pending] = useActionState(action, null);
  // An expired link brings people back here: show the link option straight away.
  const [method, setMethod] = useState<'password' | 'link'>(authError === 'link_expired' || authError === 'link_other_browser' ? 'link' : initialMethod);
  const signUp = mode === 'sign-up';
  return (
    <div className="mx-auto w-full max-w-sm space-y-5">
      <h1 className="text-center text-[28px] font-medium tracking-tight">{signUp ? t.auth.signUpTitle : t.auth.signInTitle}</h1>
      <GoogleButton label={t.auth.google} working={t.auth.working} errorText={t.auth.googleFailed} />
      {authError && (
        <p role="status" className="text-center text-[14px] text-muted">
          {authError === 'link_expired' ? t.auth.linkExpired : authError === 'link_other_browser' ? t.auth.linkOtherBrowser : t.auth.googleFailed}
        </p>
      )}
      <div className="flex items-center gap-3 text-[13px] text-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        {t.auth.or}
        <span className="h-px flex-1 bg-line" />
      </div>

      {method === 'link' ? (
        <MagicLinkPanel t={t} />
      ) : (
        <form action={formAction} className="space-y-5">
          {signUp && (
            <div>
              <label htmlFor="name" className={label}>{t.auth.name}</label>
              <input id="name" name="name" required autoComplete="name" className={input} />
            </div>
          )}
          <div>
            <label htmlFor="email" className={label}>{t.auth.email}</label>
            <input id="email" name="email" type="email" required autoComplete="email" className={input} />
          </div>
          <div>
            <label htmlFor="password" className={label}>{t.auth.password}</label>
            <input id="password" name="password" type="password" required minLength={8} autoComplete={signUp ? 'new-password' : 'current-password'} className={input} />
            {signUp && <p className="mt-1.5 text-[13px] text-faint">{t.auth.passwordHint}</p>}
          </div>
          {state?.error && <p className="text-[14px] text-muted">{t.auth.failed}</p>}
          <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
            {pending ? t.auth.working : signUp ? t.auth.signUp : t.auth.signIn}
          </button>
        </form>
      )}

      <p className="text-center">
        <button type="button" onClick={() => setMethod(method === 'link' ? 'password' : 'link')} className="text-[14px] text-ink underline underline-offset-4">
          {method === 'link' ? t.auth.magicBack : t.auth.magicUse}
        </button>
      </p>
      <p className="text-center text-[14px] text-muted">
        {signUp ? t.auth.haveAccount : t.auth.noAccount}{' '}
        <Link href={signUp ? '/auth/sign-in' : '/auth/sign-up'} className="text-ink underline underline-offset-4">
          {signUp ? t.auth.signInInstead : t.auth.createOne}
        </Link>
      </p>
    </div>
  );
}
