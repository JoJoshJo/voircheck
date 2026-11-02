import 'server-only';
import { profiles } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { cookies } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { AuthConfigError, getAuth } from './auth/server';
import { getDb } from './db';
import { isGuestEmail } from './guest';
import { DICTS, isLang, type Lang } from './i18n';

export const LANG_COOKIE = 'vc_lang';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  isGuest: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  let session;
  try {
    ({ data: session } = await getAuth().getSession());
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AuthConfigError) throw err;
    // Safety net: proxy.ts refreshes the session before pages render. If the SDK still tries to write a cookie here
    // (Next.js forbids that in a page) or the read fails, the visitor is treated as signed out, never a 500.
    console.warn(`[auth] session read failed while rendering; treating as signed out: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const u = session?.user;
  if (!u?.id) return null;
  return { id: u.id, email: u.email ?? '', name: u.name ?? '', isGuest: isGuestEmail(u.email) };
}

export async function getProfile(userId: string) {
  const [row] = await getDb().select().from(profiles).where(ownedBy(profiles, userId)).limit(1);
  return row ?? null;
}

/** Signed in + onboarded, or redirect. */
export async function requireOnboardedUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const profile = await getProfile(user.id);
  if (!profile) redirect('/onboarding');
  return { user, profile, lang: (isLang(profile.language) ? profile.language : 'en') as Lang };
}

/** Language for pages without a profile: cookie, then the browser's Accept-Language, then English. */
export async function guessLang(): Promise<Lang> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(c)) return c;
  const { headers } = await import('next/headers');
  const accept = (await headers()).get('accept-language') ?? '';
  return /^fr\b/i.test(accept.trim()) ? 'fr' : 'en';
}

export const dictFor = (lang: Lang) => DICTS[lang];
