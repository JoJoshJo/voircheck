import { redirect } from 'next/navigation';
import { Logo } from '../../components/Logo';
import { btnPrimary, card, input, label } from '../../components/ui';
import { dictFor, getCurrentUser, getProfile, guessLang } from '../../lib/user';
import { chooseLanguage, finishOnboarding } from './actions';

export const dynamic = 'force-dynamic';

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ step?: string; error?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (await getProfile(user.id)) redirect('/app');
  const { step, error } = await searchParams;
  const lang = await guessLang();
  const t = dictFor(lang);

  return (
    <main className="flex min-h-screen flex-col items-center px-6 pt-10">
      <Logo href="/onboarding" />
      <div className={`${card} mt-16 w-full max-w-md p-8`}>
        <p className="mb-6 text-[13px] text-faint">{step === 'autopay' ? '2 / 2' : '1 / 2'}</p>
        {step !== 'autopay' ? (
          <form action={chooseLanguage} className="space-y-6">
            <div>
              <h1 className="text-[24px] font-medium tracking-tight">{t.onboarding.languageTitle}</h1>
              <p className="mt-2 text-[15px] text-muted">{t.onboarding.languageBody}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['en', 'fr'] as const).map((l) => (
                <label key={l} className="flex cursor-pointer items-center gap-3 rounded-control border border-line px-4 py-3 has-[:checked]:border-ink">
                  <input type="radio" name="language" value={l} defaultChecked={l === lang} className="accent-ink" />
                  <span className="text-[15px]">{l === 'en' ? t.common.english : t.common.french}</span>
                </label>
              ))}
            </div>
            <button className={`${btnPrimary} w-full`}>{t.onboarding.continue}</button>
          </form>
        ) : (
          <form action={finishOnboarding} className="space-y-6">
            <div>
              <h1 className="text-[24px] font-medium tracking-tight">{t.onboarding.autopayTitle}</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{t.onboarding.autopayBody}</p>
            </div>
            <label className="flex items-center gap-3 text-[15px]">
              <input type="checkbox" name="autopay" className="h-4 w-4 accent-ink" />
              {t.onboarding.autopayOn}
            </label>
            <div>
              <label htmlFor="limit" className={label}>{t.onboarding.limit}</label>
              <input id="limit" name="limit" type="number" min={1} max={1000} step="0.01" defaultValue="60" className={input} />
            </div>
            {error && <p className="text-[14px] text-muted">1–1000 USD</p>}
            <button className={`${btnPrimary} w-full`}>{t.onboarding.finish}</button>
          </form>
        )}
      </div>
    </main>
  );
}
