import { STORES } from '@voircheck/shared/stores';
import type { Metadata } from 'next';
import { DemoBanner, StoreFooter, StoreHeader } from '../../../components/chrome';
import { PlantedPromptInjection } from '../../../components/PlantedPromptInjection';
import { FakeCountdown } from '../../../components/tells';
import { loadStore } from '../../../lib/store';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return STORES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store } = await loadStore((await params).slug);
  return { title: { default: store.name, template: `%s · ${store.name}` }, description: store.tagline, robots: { index: false, follow: false } };
}

export default async function StoreLayout({ params, children }: Props & { children: React.ReactNode }) {
  const { store, theme, base } = await loadStore((await params).slug);
  const c = theme.colors;
  const vars = {
    '--bg': c.bg,
    '--surface': c.surface,
    '--ink': c.ink,
    '--muted': c.muted,
    '--accent': c.accent,
    '--accent-ink': c.accentInk,
    '--border': c.border,
    '--radius': theme.radius,
    '--heading-font': theme.headingFont,
    fontFamily: theme.bodyFont,
  } as React.CSSProperties;

  return (
    <div style={vars} className="min-h-screen bg-[var(--bg)] pt-6 text-[var(--ink)]">
      <DemoBanner />
      {store.promptInjection && <PlantedPromptInjection />}
      {store.tells.fakeCountdown && <FakeCountdown />}
      <StoreHeader store={store} theme={theme} base={base} />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      <StoreFooter store={store} base={base} />
    </div>
  );
}
