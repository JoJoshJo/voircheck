/**
 * Where Neon Auth sends the browser after Google (spec 5.10). Built from the page's own origin, so it works on
 * localhost, onrender.com and later voircheck.com without hardcoding a host (each origin must be a Neon Auth
 * trusted domain). New users land on onboarding (language, then auto-pay), returning users on the workspace;
 * /app also redirects anyone without a profile to onboarding.
 */
export const OAUTH_ERROR_PARAM = 'oauth';

export function googleRedirectUrls(origin: string): { callbackURL: string; newUserCallbackURL: string; errorCallbackURL: string } {
  const u = new URL(origin);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('origin must be http(s)');
  const base = u.origin; // drops any path, query or fragment
  return {
    callbackURL: `${base}/app`,
    newUserCallbackURL: `${base}/onboarding`,
    errorCallbackURL: `${base}/auth/sign-in?error=${OAUTH_ERROR_PARAM}`,
  };
}
