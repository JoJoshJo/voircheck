import { auth } from './lib/auth/server';

/** Neon Auth session check on signed-in areas (pages re-check and load the profile themselves). */
export default auth.middleware({ loginUrl: '/auth/sign-in' });

export const config = {
  matcher: ['/app/:path*', '/onboarding/:path*', '/onboarding'],
};
