import { NextResponse, type NextRequest } from 'next/server';
import { publicOrigin } from '../../lib/app-origin';
import { CHECK_COOKIE, pendingCheckUrl, PREF_COOKIE } from '../../lib/workspace';

/**
 * "Buy through VoirCheck" on a demo store lands here: remember the product link (30 min), then open the workspace,
 * through sign-in and onboarding if needed. Nothing is scanned or paid here.
 */
export function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL('/app', publicOrigin(request.headers)), 303);
  const url = pendingCheckUrl(request.nextUrl.searchParams.get('url'));
  if (url) res.cookies.set(CHECK_COOKIE, url, { ...PREF_COOKIE, maxAge: 1800 });
  return res;
}
