import { btnPrimary, card, input, label } from '../../../components/ui';
import { DICTS } from '../../../lib/i18n';
import { requireOnboardedUser } from '../../../lib/user';
import { saveSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { user, profile, lang } = await requireOnboardedUser();
  const t = DICTS[lang];
  const { saved, error } = await searchParams;
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
    </main>
  );
}
