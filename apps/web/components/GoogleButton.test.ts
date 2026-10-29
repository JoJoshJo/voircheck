import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../lib/i18n';
import { AuthForm } from './AuthForm';
import { GoogleButton } from './GoogleButton';

const noop = async () => ({ error: false });

describe('Continue with Google', () => {
  it('renders the Mono ink button with the multicolor G mark', () => {
    const html = renderToStaticMarkup(createElement(GoogleButton, { label: 'Continue with Google', working: '…', errorText: 'x' }));
    expect(html).toContain('Continue with Google');
    expect(html).toMatch(/class="[^"]*border-line[^"]*bg-white[^"]*text-ink/);
    for (const color of ['#EA4335', '#4285F4', '#FBBC05', '#34A853']) expect(html).toContain(color);
  });

  it.each(['sign-in', 'sign-up'] as const)('sits above the email form with an "or" divider on %s (EN + FR)', (mode) => {
    for (const lang of ['en', 'fr'] as const) {
      const t = DICTS[lang];
      const html = renderToStaticMarkup(createElement(AuthForm, { mode, action: noop, t }));
      const google = html.indexOf(t.auth.google);
      const divider = html.indexOf(`>${t.auth.or}<`);
      const email = html.indexOf('name="email"');
      expect(google).toBeGreaterThan(-1);
      expect(divider).toBeGreaterThan(google);
      expect(email).toBeGreaterThan(divider);
    }
  });

  it('shows a calm inline message when Google sign-in failed or was cancelled', () => {
    const t = DICTS.en;
    expect(renderToStaticMarkup(createElement(AuthForm, { mode: 'sign-in', action: noop, t, authError: 'oauth' }))).toContain(t.auth.googleFailed);
    expect(renderToStaticMarkup(createElement(AuthForm, { mode: 'sign-in', action: noop, t }))).not.toContain(t.auth.googleFailed);
  });
});
