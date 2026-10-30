/**
 * Where Neon Auth sends the browser after Google or a magic link (spec 5.10). Built from the page's own origin, so it
 * works on localhost, onrender.com and voircheck.com without hardcoding a host (each origin must be a Neon Auth
 * trusted domain). New users land on onboarding (language, then auto-pay), returning users on the workspace;
 * /app also redirects anyone without a profile to onboarding.
 */
export const OAUTH_ERROR_PARAM = 'oauth';
/** Marker for a failed magic link (expired, already used): Better Auth may append its own ?error= code too. */
export const LINK_ERROR_PARAM = 'link';

function base(origin: string): string {
  const u = new URL(origin);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('origin must be http(s)');
  return u.origin; // drops any path, query or fragment
}

export function googleRedirectUrls(origin: string): { callbackURL: string; newUserCallbackURL: string; errorCallbackURL: string } {
  const b = base(origin);
  return { callbackURL: `${b}/app`, newUserCallbackURL: `${b}/onboarding`, errorCallbackURL: `${b}/auth/sign-in?error=${OAUTH_ERROR_PARAM}` };
}

export function magicLinkRedirectUrls(origin: string): { callbackURL: string; newUserCallbackURL: string; errorCallbackURL: string } {
  const b = base(origin);
  return { callbackURL: `${b}/app`, newUserCallbackURL: `${b}/onboarding`, errorCallbackURL: `${b}/auth/sign-in?${LINK_ERROR_PARAM}=expired` };
}

/** Which calm message the sign-in page shows after a redirect back from Google or a magic link. */
export function authErrorFromParams(params: { error?: string | string[]; link?: string | string[] }): 'link_expired' | 'link_other_browser' | 'oauth' | null {
  const all = (v?: string | string[]) => (Array.isArray(v) ? v : v ? [v] : []);
  const errors = all(params.error).map((e) => e.toUpperCase());
  if (all(params.link).includes('other_browser')) return 'link_other_browser';
  if (all(params.link).length || errors.some((e) => e.includes('TOKEN') || e === 'ATTEMPTS_EXCEEDED')) return 'link_expired';
  if (errors.length) return 'oauth';
  return null;
}
