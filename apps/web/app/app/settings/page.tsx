import { AgentTokens } from '../../../components/AgentTokens';
import { btnPrimary, btnSecondary, card, input, label } from '../../../components/ui';
import { listApiTokens } from '../../../lib/api-tokens';
import { publicOrigin } from '../../../lib/app-origin';
import { getPayPal } from '../../../lib/paypal';
import { DICTS } from '../../../lib/i18n';
import { requireOnboardedUser } from '../../../lib/user';
import { signOut } from '../../actions';
import { headers } from 'next/headers';
import { createAgentToken, removeSavedPayPal, revokeAgentToken, saveSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; removed?: string }> }) {
  const { user, profile, lang } = await requireOnboardedUser();
  const t = DICTS[lang];
  const { saved, error, removed } = await searchParams;
  const hasWallet = !!(await getPayPal().store.getActiveVaultToken(user.id));
  const date = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'medium', timeZone: 'UTC' });
  const tokens = (await listApiTokens(user.id))?.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, created: date.format(k.createdAt), lastUsed: k.lastUsedAt ? date.format(k.lastUsedAt) : null })) ?? null;
  const endpoint = `${publicOrigin(await headers())}/api/mcp`;
  return (
    <main className="mx-auto max-w-xl px-4 pb-20 sm:px-6">
      <h1 className="text-[28px] font-medium tracking-tight">{t.settings.title}</h1>
      <form action={saveSettings} className={`${card} mt-6 space-y-7 p-6`}>
        <fieldset>
          <legend className="mb-3 text-[15px] font-medium">{t.settings.language}</legend>
          <div className="grid grid-cols-2 gap-3">
            {(['en', 'fr'] as const).map((l) => (
              <label key={l} className="flex cursor-pointer items-center gap-3 rounded-control border border-line px-4 py-3 has-[:checked]:border-ink">
                <input type="radio" name="language" value={l} defaultChecked={l === lang} className="accent-ink" />
                <span className="text-[15px]">{l === 'en' ? t.common.english : t.common.french}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="mb-3 text-[15px] font-medium">{t.settings.autopay}</legend>
          <label className="flex items-center gap-3 text-[15px]">
            <input type="checkbox" name="autopay" defaultChecked={profile.autopayEnabled} className="h-4 w-4 accent-ink" />
            {t.settings.autopayOn}
          </label>
          <div>
            <label htmlFor="limit" className={label}>{t.settings.limit}</label>
            <input id="limit" name="limit" type="number" min={1} max={1000} step="0.01" defaultValue={profile.autopayLimit ?? '60'} className={input} />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-[15px] font-medium">{t.settings.account}</legend>
          <p className="text-[15px] text-muted">{user.isGuest ? t.nav.guest : user.email}</p>
          {user.isGuest && <p className="mt-2 text-[13px] text-faint">{t.settings.guestNote}</p>}
        </fieldset>
        <div className="flex items-center gap-4">
          <button className={btnPrimary}>{t.settings.save}</button>
          {saved && <span className="text-[14px] text-muted">{t.settings.saved}</span>}
          {error && <span className="text-[14px] text-muted">1–1000 USD</span>}
        </div>
      </form>
      {(profile.autopayEnabled || hasWallet) && (
        <section className={`${card} mt-6 space-y-3 p-6`}>
          <h2 className="text-[15px] font-medium">{t.wallet.title}</h2>
          <p className="text-[15px] text-muted">{removed ? t.wallet.removed : hasWallet ? t.wallet.saved : t.wallet.nextPurchase}</p>
          <p className="text-[13px] text-faint">{t.wallet.tokenOnly}</p>
          {hasWallet && (
            <form action={removeSavedPayPal}>
              <button className={btnSecondary}>{t.wallet.remove}</button>
            </form>
          )}
        </section>
      )}
      <section className={`${card} mt-6 p-6`}>
        <AgentTokens t={t.settings.agent} endpoint={endpoint} tokens={tokens} createAction={createAgentToken} revokeAction={revokeAgentToken} />
      </section>
      <form action={signOut} className="mt-6">
        <button className={btnSecondary}>{t.nav.signOut}</button>
      </form>
    </main>
  );
}
