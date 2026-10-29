'use server';

import { profiles } from '@voircheck/db/schema';
import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '../lib/auth/server';
import { getDb } from '../lib/db';
import { GUEST_EMAIL_DOMAIN } from '../lib/guest';
import { allowDemoCreation } from '../lib/rate-limit';
import { LANG_COOKIE } from '../lib/user';
import { DEMO_COOKIE } from '../lib/workspace';

/**
 * "Try the demo" (spec 5.10): a real, private, temporary account per visitor. Random email on the reserved guest
 * domain, random password that nobody ever sees; the visitor is signed in by the sign-up call itself.
 * Preset: English, Demo mode ON, Auto-pay OFF. Onboarding is skipped.
 */
export async function startDemo(): Promise<{ error: string } | never> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allowDemoCreation(ip)) return { error: 'rate' };

  const id = randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const { data, error } = await getAuth().signUp.email({
    email: `guest-${id}@${GUEST_EMAIL_DOMAIN}`,
    name: 'Demo shopper',
    password: randomBytes(24).toString('base64url'),
  });
  const userId = data?.user?.id;
  if (error || !userId) return { error: 'failed' };

  await getDb().insert(profiles).values({ userId, displayName: 'Demo shopper', language: 'en', autopayEnabled: false, autopayLimit: null }).onConflictDoNothing();
  const jar = await cookies();
  jar.set(LANG_COOKIE, 'en', { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 60 * 60 * 24 * 365 });
  jar.set(DEMO_COOKIE, '1', { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 60 * 60 * 24 * 365 });
  redirect('/app');
}

export async function signOut() {
  await getAuth().signOut();
  redirect('/');
}
