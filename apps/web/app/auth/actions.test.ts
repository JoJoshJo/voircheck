import { beforeEach, describe, expect, it, vi } from 'vitest';

// Email sign-in and sign-up land where they always did: /app and /onboarding, never the landing page.
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('../../lib/origin-check', () => ({ requireSameOrigin: async () => undefined }));
vi.mock('../../lib/auth/server', () => ({
  getAuth: () => ({ signIn: { email: async () => ({ error: null }) }, signUp: { email: async () => ({ error: null }) } }),
}));

const { signInWithEmail, signUpWithEmail } = await import('./actions');

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('email sign-in lands as before', () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it('sign-in → /app', async () => {
    await expect(signInWithEmail(null, form({ email: 'a@example.com', password: 'longenough' }))).rejects.toThrow('REDIRECT /app');
  });

  it('sign-up → /onboarding', async () => {
    await expect(signUpWithEmail(null, form({ email: 'a@example.com', password: 'longenough', name: 'A' }))).rejects.toThrow('REDIRECT /onboarding');
  });
});
