import { NEON_AUTH_HEADER_MIDDLEWARE_NAME, NEON_AUTH_SESSION_COOKIE_NAME, parseSetCookies } from '@neondatabase/auth/server';
import { NextResponse } from 'next/server';

/**
 * Session refresh happens in the proxy, never in a page. When the 5-minute session cache cookie has expired, the SDK's
 * getSession() asks Neon Auth again, and if Neon Auth renews the session it writes cookies with cookies().set(). Next.js
 * forbids that while a page renders: a 500. So the proxy runs the SDK middleware first (it renews and mints a fresh
 * cache cookie) and hands those cookies to the page request as well as to the browser; the page then reads the fresh
 * cache and never needs to write.
 */

export const SESSION_COOKIE = NEON_AUTH_SESSION_COOKIE_NAME;
const LOGIN_PATH = '/auth/sign-in';

/** The request's Cookie header with Set-Cookie values applied (Max-Age=0, a past Expires or an empty value removes). */
export function applySetCookies(cookieHeader: string, setCookies: readonly string[]): string {
  const jar = new Map<string, string>();
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  for (const header of setCookies) {
    for (const c of parseSetCookies(header)) {
      const gone = !c.value || c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now());
      if (gone) jar.delete(c.name);
      else jar.set(c.name, c.value);
    }
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * The SDK middleware's answer, made safe for pages: refreshed cookies go to the page request too. On a public page a
 * "go sign in" redirect (session gone or invalid) becomes "continue as signed out"; protected pages keep the redirect.
 * Other redirects (Google sign-in completing) pass through unchanged.
 */
export function forwardSession(request: Request, sdk: Response, opts: { protectedRoute: boolean }): Response {
  const location = sdk.headers.get('location');
  if (location) {
    const toLogin = new URL(location, request.url).pathname === LOGIN_PATH;
    if (opts.protectedRoute || !toLogin) return sdk;
  }
  const setCookies = sdk.headers.getSetCookie();
  const headers = new Headers(request.headers);
  if (!location) headers.set(NEON_AUTH_HEADER_MIDDLEWARE_NAME, 'true');
  const cookie = applySetCookies(request.headers.get('cookie') ?? '', setCookies);
  if (cookie) headers.set('cookie', cookie);
  else headers.delete('cookie');
  const out = NextResponse.next({ request: { headers } });
  for (const c of setCookies) out.headers.append('set-cookie', c);
  return out;
}
