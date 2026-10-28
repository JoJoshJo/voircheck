import { storeSlugForHost } from '@voircheck/shared/stores';
import { NextResponse, type NextRequest } from 'next/server';
import { HOST_ROUTED_HEADER } from './lib/routing';

/**
 * Host-based routing: when a request's Host matches a store's `hosts` in the shared config,
 * rewrite /path → /s/[slug]/path. Attaching a domain later needs a config entry, no code change.
 * Path-based routing (/s/[slug]/...) keeps working for every host.
 */
export function proxy(request: NextRequest) {
  const slug = storeSlugForHost(request.headers.get('host'));
  const { pathname } = request.nextUrl;
  if (!slug || pathname.startsWith('/s/')) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/s/${slug}${pathname === '/' ? '' : pathname}`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(HOST_ROUTED_HEADER, '1');
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/|robots.txt|favicon.ico).*)'],
};
