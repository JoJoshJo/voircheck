import Link from 'next/link';
import { Logo } from '../../components/Logo';
import { requireOnboardedUser } from '../../lib/user';
import { DICTS } from '../../lib/i18n';
import { signOut } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, lang } = await requireOnboardedUser();
  const t = DICTS[lang];
  const links = [
    ['/app', t.nav.workspace],
    ['/app/history', t.nav.history],
    ['/app/settings', t.nav.settings],
    ['/how-it-works', t.nav.howItWorks],
  ] as const;
  return (
    <div lang={lang}>
      {user.isGuest && <div className="bg-surface py-1.5 text-center text-[12px] text-muted">{t.common.demoBanner}</div>}
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Logo href="/app" />
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-muted">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-ink">
              {label}
            </Link>
          ))}
          <form action={signOut}>
            <button className="hover:text-ink">{t.nav.signOut}</button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
