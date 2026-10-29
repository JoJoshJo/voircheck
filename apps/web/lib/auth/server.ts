import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';

/**
 * Neon managed Better Auth (spec 5.10): email + password, Google, magic link.
 * Created on first use at RUNTIME, never at import/build time: `next build` must succeed with no auth env vars,
 * and a missing variable fails clearly on the first request that needs auth.
 */
export class AuthConfigError extends Error {
  override name = 'AuthConfigError';
}

function required(name: 'NEON_AUTH_BASE_URL' | 'NEON_AUTH_COOKIE_SECRET'): string {
  const v = process.env[name];
  if (!v) throw new AuthConfigError(`Neon Auth is not configured: ${name} is not set. Add it to the environment (Render dashboard or .env).`);
  return v;
}

type NeonAuth = ReturnType<typeof createNeonAuth>;
let instance: NeonAuth | null = null;

export function getAuth(): NeonAuth {
  instance ??= createNeonAuth({
    baseUrl: required('NEON_AUTH_BASE_URL'),
    cookies: { secret: required('NEON_AUTH_COOKIE_SECRET') },
  });
  return instance;
}

/** Test hook. */
export const resetAuthForTests = () => {
  instance = null;
};
