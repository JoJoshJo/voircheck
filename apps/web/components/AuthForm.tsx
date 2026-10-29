'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { Dict } from '../lib/i18n';
import { GoogleButton } from './GoogleButton';
import { btnPrimary, input, label } from './ui';

type Action = (prev: { error: boolean } | null, form: FormData) => Promise<{ error: boolean }>;

export function AuthForm({ mode, action, t, oauthError = false }: { mode: 'sign-in' | 'sign-up'; action: Action; t: Dict; oauthError?: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  const signUp = mode === 'sign-up';
  return (
    <form action={formAction} className="mx-auto w-full max-w-sm space-y-5">
      <h1 className="text-center text-[28px] font-medium tracking-tight">{signUp ? t.auth.signUpTitle : t.auth.signInTitle}</h1>
      <GoogleButton label={t.auth.google} working={t.auth.working} errorText={t.auth.googleFailed} />
      {oauthError && (
        <p role="status" className="text-center text-[14px] text-muted">
          {t.auth.googleFailed}
        </p>
      )}
      <div className="flex items-center gap-3 text-[13px] text-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        {t.auth.or}
        <span className="h-px flex-1 bg-line" />
      </div>
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
      <p className="text-center text-[14px] text-muted">
        {signUp ? t.auth.haveAccount : t.auth.noAccount}{' '}
        <Link href={signUp ? '/auth/sign-in' : '/auth/sign-up'} className="text-ink underline underline-offset-4">
          {signUp ? t.auth.signInInstead : t.auth.createOne}
        </Link>
      </p>
      <p className="text-center text-[13px] text-faint">{t.auth.moreSoon}</p>
    </form>
  );
}
