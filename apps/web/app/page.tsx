import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DemoButton } from '../components/DemoButton';
import { Mascot } from '../components/Mascot';
import { Reveal } from '../components/Reveal';
import { SiteHeader } from '../components/SiteHeader';
import { btnSecondary } from '../components/ui';
import { shareCard } from '../lib/og';
import { dictFor, getCurrentUser, guessLang } from '../lib/user';

export const dynamic = 'force-dynamic';

export const metadata = shareCard();

/** Outline tile icons (32px grid, 1.6px line); `vc-draw` strokes draw in when the tile scrolls into view. */
const TILE_ICONS: Record<string, ReactNode> = {
  agent: (
    <>
      <path className="vc-draw" pathLength={1} d="M5 7.5a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H13l-5 4.5v-4.5H8a3 3 0 0 1-3-3z" />
      <path className="vc-draw" pathLength={1} d="M11 13h10M11 17h6" />
    </>
  ),
  checks: (
    <>
      <rect className="vc-draw" pathLength={1} x="4" y="4" width="10" height="10" rx="2.5" />
      <rect className="vc-draw" pathLength={1} x="18" y="4" width="10" height="10" rx="2.5" />
      <rect className="vc-draw" pathLength={1} x="4" y="18" width="10" height="10" rx="2.5" />
      <path className="vc-draw" pathLength={1} d="M19.5 23l2.5 2.5 4.5-5" />
    </>
  ),
  paypal: (
    <>
      <rect className="vc-draw" pathLength={1} x="6" y="14" width="20" height="13" rx="3" />
      <path className="vc-draw" pathLength={1} d="M10.5 14v-3.5a5.5 5.5 0 0 1 11 0V14M16 19v3" />
    </>
  ),
  extension: <path className="vc-draw" pathLength={1} d="M7 9.5h5.5V8a2.5 2.5 0 0 1 5 0v1.5H23V15h-1.5a2.5 2.5 0 0 0 0 5H23v5.5H7z" />,
  agents: (
    <>
      <circle className="vc-draw" pathLength={1} cx="8" cy="16" r="3" />
      <circle className="vc-draw" pathLength={1} cx="24" cy="8" r="3" />
      <circle className="vc-draw" pathLength={1} cx="24" cy="24" r="3" />
      <path className="vc-draw" pathLength={1} d="M11 16h4.5l6-6.5M15.5 16l6 6.5" />
    </>
  ),
  receipts: (
    <>
      <path className="vc-draw" pathLength={1} d="M8 4h16v24l-2.7-2-2.6 2-2.7-2-2.7 2-2.6-2L8 28z" />
      <path className="vc-draw" pathLength={1} d="M12 11h8M12 15.5h8M12 20h5" />
    </>
  ),
};

export default async function Landing() {
  if (await getCurrentUser()) redirect('/app');
  const t = dictFor(await guessLang());
  const l = t.landing;
  const tiles = [
    ['agent', l.tileAgentTitle, l.tileAgentBody],
    ['checks', l.tileChecksTitle, l.tileChecksBody],
    ['paypal', l.tilePaypalTitle, l.tilePaypalBody],
    ['extension', l.tileExtensionTitle, l.tileExtensionBody],
    ['agents', l.tileAgentsTitle, l.tileAgentsBody],
    ['receipts', l.tileReceiptsTitle, l.tileReceiptsBody],
  ] as const;
  const proof = [
    { pill: l.proofWithout, cls: 'bg-block-bg text-block', n: '6', of: l.proofWithoutOf, body: l.proofWithoutBody, note: l.proofNote },
    { pill: l.proofWith, cls: 'bg-safe-bg text-safe', n: '0', of: l.proofWithOf, body: l.proofWithBody, note: null },
  ];
  return (
    <>
      <noscript>
        <style>{'.vc-rv{opacity:1!important;transform:none!important}.vc-rv .vc-draw{stroke-dashoffset:0!important}'}</style>
      </noscript>
      <SiteHeader t={t} signedIn={false} />
      <main>
        {/* Hero (option A, J Nov 4): large type left, the ghost assembling on the right; stone → white once it's done. */}
        <section className="vc-hero-bg">
          <div className="mx-auto grid max-w-6xl items-center gap-6 px-6 pb-16 pt-8 lg:grid-cols-[1.3fr_0.7fr] lg:gap-12 lg:pb-28 lg:pt-20">
            <div className="lg:order-last lg:flex lg:justify-center">
              <Mascot mood="SAFE" size={320} assemble title="" className="vc-hero-ghost h-24 w-24 lg:h-[320px] lg:w-[320px]" />
            </div>
            <div>
              <p className="mb-5 text-[13px] font-medium uppercase tracking-widest text-muted">{l.kicker}</p>
              {/* The one place semibold (600) is allowed (spec 5.12). */}
              <h1 className="text-[44px] font-[600] leading-[1.02] tracking-[-0.035em] sm:text-[60px] lg:text-[80px] xl:text-[88px]">{t.meta.tagline}</h1>
              <p className="mt-7 max-w-xl text-[19px] leading-relaxed text-muted sm:text-[20px]">{l.subline}</p>
              <div className="mt-9 flex flex-wrap items-start gap-3">
                <DemoButton label={l.tryDemo} working={t.auth.working} errorText={l.demoError} />
                <Link href="/how-it-works" className={btnSecondary}>
                  {l.howItWorks}
                </Link>
              </div>
              <p className="mt-4 text-[13px] text-faint">{l.tryDemoNote}</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl border-t border-line px-6 py-16 lg:py-28">
          <Reveal>
            <h2 className="mb-8 max-w-3xl text-[32px] font-medium leading-[1.08] tracking-[-0.025em] lg:mb-12 lg:text-[48px]">{l.gridTitle}</h2>
          </Reveal>
          <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map(([icon, title, body], i) => (
              <Reveal key={icon} delay={(i % 3) * 80} className="bg-white p-6 sm:p-8 lg:min-h-[220px]">
                <svg viewBox="0 0 32 32" className="h-10 w-10 text-ink" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {TILE_ICONS[icon]}
                </svg>
                <h3 className="mt-6 text-[19px] font-medium tracking-[-0.01em]">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl border-t border-line px-6 py-16 lg:py-28">
          <Reveal>
            <h2 className="mb-8 text-[32px] font-medium leading-[1.08] tracking-[-0.025em] lg:mb-12 lg:text-[48px]">{l.proofTitle}</h2>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-2 md:gap-6">
            {proof.map((p, i) => (
              <Reveal key={p.pill} delay={i * 80} className="rounded-card bg-surface p-6 sm:p-10">
                <span className={`inline-block rounded-full px-2.5 py-1 text-[13px] font-medium ${p.cls}`}>{p.pill}</span>
                <p className="mt-6 text-[84px] font-medium leading-[0.9] tracking-[-0.05em] tabular-nums sm:text-[120px]">
                  {p.n}
                  <span className="ml-2 text-[0.38em] tracking-[-0.02em] text-muted">{p.of}</span>
                </p>
                <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">{p.body}</p>
                {p.note && <p className="mt-4 text-[13px] text-faint">{p.note}</p>}
              </Reveal>
            ))}
          </div>
          <Link href="/how-it-works" className="mt-8 inline-flex min-h-11 items-center text-[15px] text-ink underline underline-offset-4">
            {l.proofLink}
          </Link>
        </section>
      </main>
    </>
  );
}
