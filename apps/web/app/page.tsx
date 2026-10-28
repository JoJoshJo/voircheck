import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DemoButton } from '../components/DemoButton';
import { Mascot } from '../components/Mascot';
import { SiteHeader } from '../components/SiteHeader';
import { btnSecondary } from '../components/ui';
import { dictFor, getCurrentUser, guessLang } from '../lib/user';

export const dynamic = 'force-dynamic';

export default async function Landing() {
  if (await getCurrentUser()) redirect('/app');
  const t = dictFor(await guessLang());
  const points = [
    [t.landing.point1Title, t.landing.point1Body],
    [t.landing.point2Title, t.landing.point2Body],
    [t.landing.point3Title, t.landing.point3Body],
  ];
  return (
    <>
      <SiteHeader t={t} signedIn={false} />
      <main className="mx-auto max-w-6xl px-6">
        <section className="mx-auto max-w-3xl pb-20 pt-16 text-center sm:pt-24">
          <div className="mb-8 flex justify-center">
            <Mascot mood="scanning" size={96} />
          </div>
          <h1 className="text-[40px] font-medium leading-[1.08] tracking-tight sm:text-[56px]">{t.landing.title}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-[19px] leading-relaxed text-muted">{t.landing.body}</p>
          <div className="mt-10 flex flex-wrap items-start justify-center gap-3">
            <DemoButton label={t.landing.tryDemo} working={t.auth.working} errorText={t.landing.demoError} />
            <Link href="/auth/sign-in" className={btnSecondary}>
              {t.landing.signIn}
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-faint">{t.landing.tryDemoNote}</p>
        </section>
        <section className="grid gap-4 border-t border-line py-16 sm:grid-cols-3">
          {points.map(([title, body]) => (
            <div key={title} className="rounded-card bg-surface p-7">
              <h2 className="text-[17px] font-medium">{title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
