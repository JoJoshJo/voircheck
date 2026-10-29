import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DICTS, fmt } from '../lib/i18n';
import { authErrorFromParams, magicLinkRedirectUrls } from '../lib/oauth';
import { AuthForm } from './AuthForm';
import { MagicLinkPanel, RESEND_COOLDOWN_S } from './MagicLinkPanel';

const noop = async () => ({ error: false });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('magic link redirect URLs', () => {
  it.each(['http://localhost:3000', 'https://voircheck-web.onrender.com', 'https://voircheck.com'])('built from the current origin: %s', (origin) => {
    expect(magicLinkRedirectUrls(origin)).toEqual({ callbackURL: `${origin}/app`, newUserCallbackURL: `${origin}/onboarding`, errorCallbackURL: `${origin}/auth/sign-in?link=expired` });
  });
  it('drops path/query from the page and refuses non-http origins', () => {
    expect(magicLinkRedirectUrls('https://voircheck.com/auth/sign-up?x=1').callbackURL).toBe('https://voircheck.com/app');
    expect(() => magicLinkRedirectUrls('javascript:alert(1)')).toThrow();
  });
});

describe('sign-in page messages after a redirect', () => {
  it.each([
    [{ link: 'expired' }, 'link_expired'],
    [{ link: 'expired', error: 'EXPIRED_TOKEN' }, 'link_expired'],
    [{ error: ['link', 'INVALID_TOKEN'] }, 'link_expired'],
    [{ error: 'oauth' }, 'oauth'],
    [{ error: 'access_denied' }, 'oauth'],
    [{}, null],
  ] as const)('%j → %s', (params, expected) => {
    expect(authErrorFromParams(params as never)).toBe(expected);
  });

  it('an expired link shows "That link expired. Send a new one." with the link form open', () => {
    const t = DICTS.en;
    const html = renderToStaticMarkup(createElement(AuthForm, { mode: 'sign-in', action: noop, t, authError: 'link_expired' }));
    expect(text(html)).toContain('That link expired. Send a new one.');
    expect(html).toContain('name="magic-email"');
    expect(html).not.toContain('name="password"');
  });
});

describe('"Email me a sign-in link" UI states', () => {
  it.each(['sign-in', 'sign-up'] as const)('%s: password form by default, with the option to switch to a link', (mode) => {
    const t = DICTS.en;
    const html = renderToStaticMarkup(createElement(AuthForm, { mode, action: noop, t }));
    expect(html).toContain('name="password"');
    expect(text(html)).toContain('Email me a sign-in link');
    expect(text(html)).not.toContain('coming soon');
  });

  it('link method: email field + send button, and a way back to the password', () => {
    const html = renderToStaticMarkup(createElement(AuthForm, { mode: 'sign-in', action: noop, t: DICTS.en, initialMethod: 'link' }));
    expect(html).toContain('name="magic-email"');
    expect(text(html)).toContain('Send me a link');
    expect(text(html)).toContain('Use a password instead');
  });

  it('after sending: "Check your inbox", the address, "Use a different email", resend on a 60 s cooldown', () => {
    const t = DICTS.en;
    const html = text(renderToStaticMarkup(createElement(MagicLinkPanel, { t, initialSentTo: 'ama@example.com', initialCooldown: RESEND_COOLDOWN_S })));
    expect(RESEND_COOLDOWN_S).toBe(60);
    expect(html).toContain('Check your inbox');
    expect(html).toContain('ama@example.com');
    expect(html).toContain('Use a different email');
    expect(html).toContain('Send it again in 60 s');
    const ready = text(renderToStaticMarkup(createElement(MagicLinkPanel, { t, initialSentTo: 'ama@example.com', initialCooldown: 0 })));
    expect(ready).toContain('Send it again');
    expect(ready).not.toContain('Send it again in');
  });

  it('French strings', () => {
    const t = DICTS.fr;
    const html = text(renderToStaticMarkup(createElement(MagicLinkPanel, { t, initialSentTo: 'ama@example.com', initialCooldown: 42 })));
    expect(html).toContain('Consultez votre boîte de réception');
    expect(html).toContain(fmt(t.auth.magicResendIn, { s: 42 }));
  });
});
