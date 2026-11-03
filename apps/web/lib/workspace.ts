/** Demo-mode toggle state (ON by default, spec 5.3). Stored per browser; each request records it on shopping_sessions. */
export const DEMO_COOKIE = 'vc_demo';
export const demoModeFrom = (value: string | undefined) => value !== '0';

/** Our preference cookies (language, Demo mode): nothing secret, still Secure in production (Render is https only). */
export const PREF_COOKIE = { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === 'production' } as const;

/**
 * "Buy through VoirCheck" from a demo store: /check?url=… keeps the link in this cookie through sign-in and
 * onboarding (which all end on /app), and the workspace opens with it in the check box. Any site can link here, so
 * it isn't scanned automatically unless /check also set CHECK_AUTO_COOKIE (below); otherwise the person presses Check.
 */
export const CHECK_COOKIE = 'vc_check';

/**
 * The same link, marked to start scanning on arrival (spec 5.23, Nov 3). /check sets it only for a signed-in person
 * whose navigation came from outside any website (Sec-Fetch-Site: none: the extension's chrome.tabs.create, a typed
 * URL or bookmark, a link opened from another app). Its value is the link itself, so it can only start that link,
 * and it lasts 2 minutes. Rate limits and daily caps still apply in /api/scans.
 */
export const CHECK_AUTO_COOKIE = 'vc_check_auto';
export const CHECK_AUTO_MAX_AGE_S = 120;

/** Auto-start only for user-initiated navigations by a signed-in person; any website's link stays manual. */
export function autoStartCheck(o: { secFetchSite: string | null; signedIn: boolean }): boolean {
  return o.signedIn && o.secFetchSite === 'none';
}

/** On /app: start scanning only if the auto mark names this very link. */
export const autoStartFor = (initialCheck: string | null, autoCookie: string | undefined): boolean => !!initialCheck && autoCookie === initialCheck;

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
