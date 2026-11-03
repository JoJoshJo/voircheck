/** Demo-mode toggle state (ON by default, spec 5.3). Stored per browser; each request records it on shopping_sessions. */
export const DEMO_COOKIE = 'vc_demo';
export const demoModeFrom = (value: string | undefined) => value !== '0';

/** Our preference cookies (language, Demo mode): nothing secret, still Secure in production (Render is https only). */
export const PREF_COOKIE = { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === 'production' } as const;

/**
 * "Buy through VoirCheck" from a demo store: /check?url=… keeps the link in this cookie through sign-in and
 * onboarding (which all end on /app), and the workspace opens with it in the check box. Never scanned automatically:
 * any site can link here, so the person presses Check themselves.
 */
export const CHECK_COOKIE = 'vc_check';

/** A link we'll put in the check box: http(s), no credentials, at most 2048 characters. Anything else → null. */
export function pendingCheckUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
