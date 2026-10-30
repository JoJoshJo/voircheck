import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthForm } from '../components/AuthForm';
import { MAGIC_PENDING_COOKIE, pendingCookie, verifierAction, withoutVerifier } from './auth/magic-link-exchange';
import { DICTS } from './i18n';
import { authErrorFromParams } from './oauth';

const at = (q = '') => new URL(`https://voircheck.com/app${q}`);
const withVerifier = at('?neon_auth_session_verifier=abc123');

describe('which path completes a sign-in that comes back with a session verifier', () => {
  it('no verifier → nothing to do', () => {
    expect(verifierAction(at(), [MAGIC_PENDING_COOKIE])).toBe('none');
  });
  it('Google (SDK challenge cookie present) → left to the SDK middleware, unchanged', () => {
    expect(verifierAction(withVerifier, ['__Secure-neon-auth.session_challenge'])).toBe('sdk');
    expect(verifierAction(withVerifier, ['__Secure-neon-auth.session_challange', MAGIC_PENDING_COOKIE])).toBe('sdk');
  });
  it('magic link requested in this browser → we exchange the verifier (the bug: previously nobody did)', () => {
    expect(verifierAction(withVerifier, [MAGIC_PENDING_COOKIE, 'vc_lang'])).toBe('exchange');
  });
  it('verifier with nothing tying it to this browser → refused (no login CSRF), with a clear message', () => {
    expect(verifierAction(withVerifier, ['vc_lang'])).toBe('other_browser');
    expect(authErrorFromParams({ link: 'other_browser' })).toBe('link_other_browser');
  });
  it('after the exchange the verifier is removed from the URL, the rest kept', () => {
    expect(withoutVerifier(at('?neon_auth_session_verifier=abc&x=1')).href).toBe('https://voircheck.com/app?x=1');
  });
});

describe('the pending cookie set when a magic link is requested', () => {
  it('is HttpOnly, SameSite=Lax (sent on the email-link navigation), 15 minutes, Secure on https', () => {
    expect(pendingCookie(true)).toBe('vc_magic_pending=1; Path=/; Max-Age=900; HttpOnly; SameSite=Lax; Secure');
    expect(pendingCookie(false)).not.toContain('Secure');
    expect(pendingCookie(true, true)).toContain('Max-Age=0');
  });
});

describe('sign-in page messages', () => {
  it.each(['en', 'fr'] as const)('other browser → "open it in the same browser" (%s), link form open', (lang) => {
    const t = DICTS[lang];
    const html = renderToStaticMarkup(createElement(AuthForm, { mode: 'sign-in', action: async () => ({ error: false }), t, authError: 'link_other_browser' }));
    expect(html.replace(/&#x27;|&#39;/g, "'")).toContain(t.auth.linkOtherBrowser.replace(/'/g, "'"));
    expect(html).toContain('name="magic-email"');
  });
  it('a bounce that still carries a verifier (old behaviour) no longer happens silently: failures land on ?link=…', () => {
    expect(authErrorFromParams({ link: 'expired' })).toBe('link_expired');
  });
});
