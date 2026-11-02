import { NextResponse, type NextRequest } from 'next/server';
import { authHandlers } from './lib/auth/handlers';
import { pendingCookie, verifierAction, VERIFIER_PARAM, withoutVerifier } from './lib/auth/magic-link-exchange';
import { getAuth } from './lib/auth/server';
import { forwardSession, SESSION_COOKIE } from './lib/auth/session-refresh';

/**
 * Neon Auth session check on signed-in areas (pages re-check and load the profile themselves). Built per request.
 * Also refreshes the session before any page that reads it renders (see lib/auth/session-refresh.ts), and completes
 * magic-link sign-in, which the SDK middleware can't (see lib/auth/magic-link-exchange.ts).
 */
export default async function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const action = verifierAction(url, request.cookies.getAll().map((c) => c.name));
  const secure = url.protocol === 'https:';

  if (action === 'other_browser') {
    return NextResponse.redirect(new URL('/auth/sign-in?link=other_browser', url));
  }
  if (action === 'exchange') {
    const exchangeUrl = new URL('/api/auth/get-session', url);
    exchangeUrl.searchParams.set(VERIFIER_PARAM, url.searchParams.get(VERIFIER_PARAM)!);
    const res = await authHandlers().GET(new Request(exchangeUrl, { headers: request.headers }), { params: Promise.resolve({ path: ['get-session'] }) });
    const body = (await res.json().catch(() => null)) as { user?: unknown } | null;
    const sessionCookies = res.headers.getSetCookie();
    const out = res.ok && body?.user && sessionCookies.length ? NextResponse.redirect(withoutVerifier(url)) : NextResponse.redirect(new URL('/auth/sign-in?link=expired', url));
    if (res.ok && body?.user) for (const c of sessionCookies) out.headers.append('set-cookie', c);
    out.headers.append('set-cookie', pendingCookie(secure, true));
    return out;
  }
  const protectedRoute = PROTECTED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  // Public pages: anonymous visitors cost nothing; signed-in ones get the same refresh, never a sign-in redirect.
  if (!protectedRoute && !request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const sdk = await getAuth().middleware({ loginUrl: '/auth/sign-in' })(request);
  return forwardSession(request, sdk, { protectedRoute });
}

const PROTECTED = ['/app', '/onboarding'];

export const config = {
  // Signed-in areas, plus the public pages that read the session (landing redirect, header, page language).
  matcher: ['/app/:path*', '/onboarding/:path*', '/onboarding', '/', '/how-it-works', '/privacy', '/terms'],
};
