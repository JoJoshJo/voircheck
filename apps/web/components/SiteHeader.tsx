import Link from 'next/link';
import { DICTS, type Dict, type Lang } from '../lib/i18n';
import { DemoButton } from './DemoButton';
import { LangSwitch } from './LangSwitch';
import { Logo } from './Logo';
import { btnPrimarySm } from './ui';

const GITHUB_URL = 'https://github.com/JoJoshJo/voircheck';

/**
 * Public-page header (design-pass item 7): How it works, a GitHub link, the
 * EN/FR switch, and a primary action — "Try the demo" (or "Open my workspace"
 * when signed in). `workspaceLabel` lets the landing page say more than the
 * app nav's "Workspace".
 */
export function SiteHeader({ t, signedIn, workspaceLabel }: { t: Dict; signedIn: boolean; workspaceLabel?: string }) {
  // The page passes the dict for the active language; recover the code from it
  // so every caller doesn't have to thread `lang` through as well.
  const lang: Lang = t === DICTS.fr ? 'fr' : 'en';
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
      <Logo />
      <nav className="flex items-center gap-4 text-[14px] text-muted sm:gap-5">
        <Link href="/how-it-works" className="hidden hover:text-ink sm:inline">
          {t.nav.howItWorks}
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="VoirCheck on GitHub"
          className="hidden text-muted hover:text-ink sm:inline-flex"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85l-.01 2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
          </svg>
        </a>
        <LangSwitch current={lang} labels={{ en: t.common.english, fr: t.common.french }} />
        {signedIn ? (
          <Link href="/app" className={btnPrimarySm}>
            {workspaceLabel ?? t.nav.workspace}
          </Link>
        ) : (
          <>
            <Link href="/auth/sign-in" className="hidden hover:text-ink sm:inline">
              {t.nav.signIn}
            </Link>
            <DemoButton label={t.landing.tryDemo} working={t.auth.working} errorText={t.landing.demoError} className={btnPrimarySm} />
          </>
        )}
      </nav>
    </header>
  );
}
