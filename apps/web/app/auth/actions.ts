'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '../../lib/auth/server';
import { GUEST_EMAIL_DOMAIN } from '../../lib/guest';

const Creds = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(8).max(200) });

export async function signInWithEmail(_prev: { error: boolean } | null, form: FormData) {
  const parsed = Creds.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: true };
  const { error } = await auth.signIn.email(parsed.data);
  if (error) return { error: true };
  redirect('/app');
}

export async function signUpWithEmail(_prev: { error: boolean } | null, form: FormData) {
  const parsed = Creds.extend({ name: z.string().trim().min(1).max(100) }).safeParse({ email: form.get('email'), password: form.get('password'), name: form.get('name') });
  // The guest domain is reserved for "Try the demo" accounts.
  if (!parsed.success || parsed.data.email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) return { error: true };
  const { error } = await auth.signUp.email(parsed.data);
  if (error) return { error: true };
  redirect('/onboarding');
}
