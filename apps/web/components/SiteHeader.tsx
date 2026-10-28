import Link from 'next/link';
import type { Dict } from '../lib/i18n';
import { Logo } from './Logo';

export function SiteHeader({ t, signedIn }: { t: Dict; signedIn: boolean }) {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <Logo />
      <nav className="flex items-center gap-6 text-[14px] text-muted">
        <Link href="/how-it-works" className="hover:text-ink">
          {t.nav.howItWorks}
        </Link>
        <Link href={signedIn ? '/app' : '/auth/sign-in'} className="hover:text-ink">
          {signedIn ? t.nav.workspace : t.nav.signIn}
        </Link>
      </nav>
    </header>
  );
}
