'use server';

import { profiles } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../../../lib/db';
import { AutopayForm, LangForm } from '../../../lib/profile-input';
import { getCurrentUser, LANG_COOKIE } from '../../../lib/user';

export async function saveSettings(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const lang = LangForm.safeParse({ language: form.get('language') });
  const autopay = AutopayForm.safeParse({ autopay: form.get('autopay') ?? undefined, limit: form.get('limit') ?? undefined });
  if (!lang.success || !autopay.success) redirect('/app/settings?error=1');
  await getDb().update(profiles).set({ language: lang.data.language, ...autopay.data }).where(ownedBy(profiles, user.id));
  (await cookies()).set(LANG_COOKIE, lang.data.language, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  redirect('/app/settings?saved=1');
}
