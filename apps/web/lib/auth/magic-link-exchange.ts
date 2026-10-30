/**
 * Magic-link session hand-off (pinned @neondatabase/auth@0.7.0-beta).
 *
 * Root cause of "magic link bounces back to sign-in": the link is verified on the Neon Auth host, which redirects to
 * our callbackURL with ?neon_auth_session_verifier=… . The SDK middleware only exchanges that verifier when the OAuth
 * `session_challenge` cookie is present, and that cookie is only set when Google sign-in starts, never when a magic
 * link is requested. So the exchange was skipped, there was no session, and the middleware redirected to sign-in.
 *
 * Neon accepts the verifier without the challenge (verified Oct 29), but exchanging any verifier would allow login
 * CSRF (someone sends you a link with THEIR verifier and you're signed into their account). So we set our own
 * short-lived `vc_magic_pending` cookie when this browser requests a link, and exchange only when it's present.
 * A link opened in a different browser gets a clear message instead.
 */
export const VERIFIER_PARAM = 'neon_auth_session_verifier';
export const MAGIC_PENDING_COOKIE = 'vc_magic_pending';
export const MAGIC_PENDING_MAX_AGE_S = 15 * 60; // links expire after 5 minutes; a little slack for slow inboxes
const SDK_CHALLENGE_COOKIES = ['__Secure-neon-auth.session_challenge', '__Secure-neon-auth.session_challange'];

export type VerifierAction =
  | 'none' // no verifier in the URL
  | 'sdk' // OAuth (Google): the SDK middleware has its challenge cookie and handles it
  | 'exchange' // magic link requested in this browser: we exchange the verifier
  | 'other_browser'; // a verifier but nothing tying it to this browser: refuse, explain

export function verifierAction(url: URL, cookieNames: Iterable<string>): VerifierAction {
  if (!url.searchParams.get(VERIFIER_PARAM)) return 'none';
  const names = new Set(cookieNames);
  if (SDK_CHALLENGE_COOKIES.some((c) => names.has(c))) return 'sdk';
  return names.has(MAGIC_PENDING_COOKIE) ? 'exchange' : 'other_browser';
}

/** The URL to send the browser to after a successful exchange: same page, verifier removed. */
export function withoutVerifier(url: URL): URL {
  const clean = new URL(url);
  clean.searchParams.delete(VERIFIER_PARAM);
  return clean;
}

/** Set-Cookie for the pending marker (added to a successful magic-link request) and for clearing it. */
export function pendingCookie(secure: boolean, clear = false): string {
  return [`${MAGIC_PENDING_COOKIE}=${clear ? '' : '1'}`, 'Path=/', `Max-Age=${clear ? 0 : MAGIC_PENDING_MAX_AGE_S}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ');
}
