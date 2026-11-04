'use server';

import { auditLog, profiles, vaultTokens } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createApiToken, revokeApiToken } from '../../../lib/api-tokens';
import { getDb } from '../../../lib/db';
import { AutopayForm, LangForm } from '../../../lib/profile-input';
import { getCurrentUser, LANG_COOKIE } from '../../../lib/user';
import { PREF_COOKIE } from '../../../lib/workspace';

export async function saveSettings(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const lang = LangForm.safeParse({ language: form.get('language') });
  const autopay = AutopayForm.safeParse({ autopay: form.get('autopay') ?? undefined, limit: form.get('limit') ?? undefined });
  if (!lang.success || !autopay.success) redirect('/app/settings?error=1');
  await getDb().update(profiles).set({ language: lang.data.language, ...autopay.data }).where(ownedBy(profiles, user.id));
  (await cookies()).set(LANG_COOKIE, lang.data.language, PREF_COOKIE);
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

export type AgentTokenState = { token: string } | { error: 'guest' | 'limit' | 'unavailable' } | null;

/** "Connect an AI agent": creates an MCP API token and returns it ONCE to this response. Only its hash is stored. */
export async function createAgentToken(_prev: AgentTokenState, form: FormData): Promise<AgentTokenState> {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const name = String(form.get('name') ?? '').slice(0, 60);
  const created = await createApiToken(user.id, name, user.isGuest);
  if (typeof created === 'string') return { error: created };
  await getDb().insert(auditLog).values({ userId: user.id, actor: 'user', action: 'api_token.created', entity: 'api_token', entityId: created.view.id, details: { prefix: created.view.prefix } });
  revalidatePath('/app/settings');
  return { token: created.token };
}

export async function revokeAgentToken(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const id = String(form.get('id') ?? '');
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    await revokeApiToken(user.id, id);
    await getDb().insert(auditLog).values({ userId: user.id, actor: 'user', action: 'api_token.revoked', entity: 'api_token', entityId: id, details: {} });
  }
  redirect('/app/settings?revoked=1');
}
