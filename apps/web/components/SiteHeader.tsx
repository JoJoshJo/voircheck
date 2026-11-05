import Link from 'next/link';
import type { Dict } from '../lib/i18n';
import { Logo } from './Logo';

/** `workspaceLabel`: the signed-in link's text where a page wants more than "Workspace" (the landing page). */
export function SiteHeader({ t, signedIn, workspaceLabel }: { t: Dict; signedIn: boolean; workspaceLabel?: string }) {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <Logo />
      <nav className="flex items-center gap-6 text-[14px] text-muted">
        <Link href="/how-it-works" className="hover:text-ink">
          {t.nav.howItWorks}
        </Link>
        <Link href={signedIn ? '/app' : '/auth/sign-in'} className="hover:text-ink">
          {signedIn ? (workspaceLabel ?? t.nav.workspace) : t.nav.signIn}
        </Link>
      </nav>
    </header>
  );
}
