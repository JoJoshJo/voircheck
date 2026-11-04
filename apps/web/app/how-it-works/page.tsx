import { SiteHeader } from '../../components/SiteHeader';
import { card } from '../../components/ui';
import { DICTS, isLang } from '../../lib/i18n';
import { shareCard } from '../../lib/og';
import { getCurrentUser, getProfile, guessLang } from '../../lib/user';
import { WEIGHTS } from '@voircheck/scanner';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'How it works', ...shareCard('How VoirCheck works') };

const IDS = ['domain_age', 'ssl_redirects', 'price', 'ai_page', 'threat_list', 'clone'] as const;
const KEYS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;

// Published sources for "Why now" (the only ones cited; text in i18n `how.why1`–`why5`).
const WHY_NOW = [
  ['why1', 'https://guard.io/labs/scamlexity-we-put-agentic-ai-browsers-to-the-test-they-clicked-they-paid-they-failed'],
  ['why2', 'https://corporate.visa.com/en/sites/visa-perspectives/security-trust/the-threats-landscape-of-agentic-commerce.html'],
  ['why3', 'https://thepaypers.com/payments/expert-views/know-your-merchant-the-trust-gap-at-the-heart-of-ai-commerce'],
  ['why4', 'https://www.emergentmind.com/papers/2601.22569'],
  ['why5', 'https://origin-unit42.paloaltonetworks.com/retail-fraud-agentic-ai/'],
] as const;

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
                  {t.signals.status_warn}{t.colon} {WEIGHTS[id].warn} · {t.signals.status_fail}{t.colon} {WEIGHTS[id].fail}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-[17px] font-medium">{t.how.thresholds}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{t.how.rules}</p>
        {([
          ['agentTitle', 'agentBody'],
          ['moneyTitle', 'moneyBody'],
          ['extTitle', 'extBody'],
        ] as const).map(([title, body]) => (
          <section key={title} className="mt-12">
            <h2 className="text-[20px] font-medium">{t.how[title]}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{t.how[body]}</p>
          </section>
        ))}
        <section className="mt-12">
          <h2 className="text-[20px] font-medium">{t.how.whyTitle}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{t.how.whyIntro}</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
            {WHY_NOW.map(([key, href]) => (
              <li key={key}>
                <a href={href} className="underline underline-offset-4 hover:text-ink" rel="noopener noreferrer">
                  {t.how[key]}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section className="mt-14 rounded-card bg-surface p-7">
          <h2 className="text-[20px] font-medium">{t.how.accuracyTitle}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{t.how.accuracyBody}</p>
          <p className="mt-4 text-[15px] font-medium">{t.how.tuneTitle}</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted">
            <li>{t.how.tune1}</li>
            <li>{t.how.tune2}</li>
            <li>{t.how.tune3}</li>
          </ul>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">{t.how.holdout}</p>
        </section>
      </main>
    </>
  );
}
