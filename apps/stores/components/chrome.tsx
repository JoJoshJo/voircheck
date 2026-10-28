import type { StoreConfig, Theme } from '@voircheck/shared/stores';
import Link from 'next/link';
import { href } from '../lib/store';

/** Required on every page (spec 5.8 / hard constraints). */
export function DemoBanner() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-[#0C0C0C] px-4 py-1 text-center text-xs text-white">
      Fictional demo store — VoirCheck hackathon project.
    </div>
  );
}

const NAV = [
  { path: '', label: 'Shop' },
  { path: '/reviews', label: 'Reviews' },
  { path: '/about', label: 'About & contact' },
  { path: '/cart', label: 'Cart' },
];

export function StoreHeader({ store, theme, base }: { store: StoreConfig; theme: Theme; base: string }) {
  const links = NAV.map((n) => (
    <Link key={n.label} href={href(base, n.path)} className="hover:underline">
      {n.label}
    </Link>
  ));
  const logo = (
    <Link href={href(base)} className="text-2xl font-semibold tracking-tight" style={{ fontFamily: theme.headingFont }}>
      {store.name}
    </Link>
  );

  if (theme.layout === 'classic') {
    return (
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-6 text-center">
        {logo}
        <p className="mt-1 text-sm text-[var(--muted)]">{store.tagline}</p>
        <nav className="mt-4 flex justify-center gap-6 text-sm">{links}</nav>
      </header>
    );
  }
  if (theme.layout === 'split') {
    return (
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          {logo}
          <p className="text-xs text-[var(--muted)]">{store.tagline}</p>
        </div>
        <nav className="flex gap-5 text-sm">{links}</nav>
      </header>
    );
  }
  return (
    <header className="bg-[var(--accent)] px-6 py-4 text-[var(--accent-ink)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        {logo}
        <nav className="flex gap-5 text-sm font-medium">{links}</nav>
      </div>
    </header>
  );
}

export function StoreFooter({ store, base }: { store: StoreConfig; base: string }) {
  return (
    <footer className="mt-16 border-t border-[var(--border)] px-6 py-8 text-sm text-[var(--muted)]">
      <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-4">
        <span>© 2026 {store.name}</span>
        <nav className="flex flex-wrap gap-5">
          <Link href={href(base, '/about')}>About & contact</Link>
          <Link href={href(base, '/reviews')}>Reviews</Link>
          <Link href={href(base, '/policies/refund')}>Refund policy</Link>
          <Link href={href(base, '/policies/shipping')}>Shipping policy</Link>
        </nav>
      </div>
    </footer>
  );
}
