import type { NextRequest } from 'next/server';
import { getAuth } from './lib/auth/server';

/** Neon Auth session check on signed-in areas (pages re-check and load the profile themselves). Built per request. */
export default function proxy(request: NextRequest) {
  return getAuth().middleware({ loginUrl: '/auth/sign-in' })(request);
}

export const config = {
  matcher: ['/app/:path*', '/onboarding/:path*', '/onboarding'],
};
