'use server';

import { auditLog, profiles, vaultTokens } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { and, eq } from 'drizzle-orm';
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

/**
 * "Remove saved PayPal": stops Auto-pay from using the saved wallet. The token is marked REMOVED in our database
 * (owner-scoped). Deleting it at PayPal (DELETE /v3/vault/payment-tokens/{id}) needs the vault/payment-tokens scope
 * this sandbox app doesn't have yet; the token is useless to anyone without our server credentials either way.
 */
export async function removeSavedPayPal() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const db = getDb();
  const removed = await db
    .update(vaultTokens)
    .set({ status: 'REMOVED' })
    .where(ownedBy(vaultTokens, user.id, and(eq(vaultTokens.status, 'VAULTED'))))
    .returning({ id: vaultTokens.id });
  await db.insert(auditLog).values({ userId: user.id, actor: 'user', action: 'vault.removed', entity: 'vault_token', entityId: null, details: { count: removed.length } });
  redirect('/app/settings?removed=1');
}
