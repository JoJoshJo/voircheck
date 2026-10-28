import { SiteHeader } from '../../components/SiteHeader';
import { card } from '../../components/ui';
import { DICTS, isLang } from '../../lib/i18n';
import { getCurrentUser, getProfile, guessLang } from '../../lib/user';
import { WEIGHTS } from '@voircheck/scanner';

export const dynamic = 'force-dynamic';

const IDS = ['domain_age', 'ssl_redirects', 'price', 'ai_page', 'threat_list', 'clone'] as const;
const KEYS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;

export default async function HowItWorks() {
  const user = await getCurrentUser();
  const profile = user ? await getProfile(user.id) : null;
  const lang = profile && isLang(profile.language) ? profile.language : await guessLang();
  const t = DICTS[lang];
  return (
    <>
      <SiteHeader t={t} signedIn={!!user} />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        <h1 className="text-[36px] font-medium leading-tight tracking-tight">{t.how.title}</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-muted">{t.how.intro}</p>
        <ol className="mt-10 space-y-3">
          {IDS.map((id, i) => (
            <li key={id} className={`${card} flex gap-5 p-6`}>
              <span className="text-[15px] font-medium text-faint">{i + 1}</span>
              <div>
                <h2 className="text-[17px] font-medium">{t.signals[id]}</h2>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t.how[KEYS[i]!]}</p>
                <p className="mt-2 text-[13px] text-faint">
                  {t.signals.status_warn}: {WEIGHTS[id].warn} · {t.signals.status_fail}: {WEIGHTS[id].fail}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-[17px] font-medium">{t.how.thresholds}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{t.how.rules}</p>
        <section className="mt-14 rounded-card bg-surface p-7">
          <h2 className="text-[20px] font-medium">{t.how.accuracyTitle}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{t.how.accuracyBody}</p>
        </section>
      </main>
    </>
  );
}
