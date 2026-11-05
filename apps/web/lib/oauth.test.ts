import { describe, expect, it } from 'vitest';
import { googleRedirectUrls, magicLinkRedirectUrls } from './oauth';

describe('Google sign-in redirect URLs', () => {
  it.each(['http://localhost:3000', 'https://voircheck-web.onrender.com', 'https://voircheck.com'])('built from the current origin: %s', (origin) => {
    expect(googleRedirectUrls(origin)).toEqual({
      callbackURL: `${origin}/app`,
      newUserCallbackURL: `${origin}/onboarding`,
      errorCallbackURL: `${origin}/auth/sign-in?error=oauth`,
    });
  });

  it('never carries over a path, query or fragment from the page', () => {
    expect(googleRedirectUrls('https://voircheck-web.onrender.com/auth/sign-up?x=1#y').callbackURL).toBe('https://voircheck-web.onrender.com/app');
  });

  it('refuses non-http origins', () => {
    expect(() => googleRedirectUrls('javascript:alert(1)')).toThrow();
  });
});

describe('magic-link redirect URLs', () => {
  it('land on /app, new users on /onboarding (never on the landing page)', () => {
    expect(magicLinkRedirectUrls('https://voircheck.com')).toEqual({
      callbackURL: 'https://voircheck.com/app',
      newUserCallbackURL: 'https://voircheck.com/onboarding',
      errorCallbackURL: 'https://voircheck.com/auth/sign-in?link=expired',
    });
  });
});
