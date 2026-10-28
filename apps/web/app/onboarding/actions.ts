'use server';

import { profiles } from '@voircheck/db/schema';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../../lib/db';
import { AutopayForm, LangForm } from '../../lib/profile-input';
import { getCurrentUser, LANG_COOKIE } from '../../lib/user';

export async function chooseLanguage(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const parsed = LangForm.safeParse({ language: form.get('language') });
  if (!parsed.success) redirect('/onboarding');
  (await cookies()).set(LANG_COOKIE, parsed.data.language, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  redirect('/onboarding?step=autopay');
}

export async function finishOnboarding(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const lang = LangForm.safeParse({ language: (await cookies()).get(LANG_COOKIE)?.value });
  const autopay = AutopayForm.safeParse({ autopay: form.get('autopay') ?? undefined, limit: form.get('limit') ?? undefined });
  if (!lang.success || !autopay.success) redirect('/onboarding?step=autopay&error=1');
  // The row's user_id is always the signed-in user; nothing from the form decides whose profile this is.
  await getDb()
    .insert(profiles)
    .values({ userId: user.id, displayName: user.name || null, language: lang.data.language, ...autopay.data })
    .onConflictDoUpdate({ target: profiles.userId, set: { language: lang.data.language, ...autopay.data } });
  redirect('/app');
}
