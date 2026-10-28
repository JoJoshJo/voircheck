import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';

/**
 * Neon managed Better Auth (spec 5.10). Email + password today.
 * TODO(magic link): needs Resend for email delivery; enable in Neon Console → Auth, then add a sign-in form calling auth.signIn.emailOtp().
 * TODO(Google): needs an OAuth client ID/secret configured in Neon Console → Auth → OAuth; then a button calling auth.signIn.social({ provider: 'google' }).
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const auth = createNeonAuth({
  baseUrl: required('NEON_AUTH_BASE_URL'),
  cookies: { secret: required('NEON_AUTH_COOKIE_SECRET') },
});
