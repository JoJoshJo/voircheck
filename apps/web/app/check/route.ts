import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '../../lib/user';
import { autoStartCheck, CHECK_AUTO_COOKIE, CHECK_AUTO_MAX_AGE_S, CHECK_COOKIE, pendingCheckUrl, PREF_COOKIE } from '../../lib/workspace';

/**
 * "Buy through VoirCheck" on a demo store and the Chrome extension's "Check this store" land here: remember the
 * product link (30 min), then open the workspace, through sign-in and onboarding if needed. Nothing is paid here.
 * A signed-in person's own navigation (Sec-Fetch-Site: none) also marks the link to start scanning on arrival; a link
 * from any website (cross-site, same-site, or no header) only fills the check box, so no site can start scans.
 *
 * The redirect is relative (/app on the host this request came to), never APP_URL: the cookies below belong to this
 * host, so sending the browser to another one (APP_URL is voircheck-web.onrender.com on Render) lost the link and the
 * sign-in (Nov 11). A relative Location can't point anywhere else, so no header can redirect it off-site.
 */
export async function GET(request: NextRequest) {
  const res = new NextResponse(null, { status: 303, headers: { location: '/app' } });
  const url = pendingCheckUrl(request.nextUrl.searchParams.get('url'));
  if (!url) return res;
  res.cookies.set(CHECK_COOKIE, url, { ...PREF_COOKIE, maxAge: 1800 });
  const auto = autoStartCheck({ secFetchSite: request.headers.get('sec-fetch-site'), signedIn: !!(await getCurrentUser()) });
  if (auto) res.cookies.set(CHECK_AUTO_COOKIE, url, { ...PREF_COOKIE, maxAge: CHECK_AUTO_MAX_AGE_S });
  else res.cookies.set(CHECK_AUTO_COOKIE, '', { ...PREF_COOKIE, maxAge: 0 });
  return res;
}
