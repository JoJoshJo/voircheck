import Link from 'next/link';
import type { Dict } from '../lib/i18n';

const GITHUB_URL = 'https://github.com/JoJoshJo/voircheck';

/** Small footer on every page: the hackathon credit + GitHub, then Privacy · Terms · How it works. */
export function SiteFooter({ t }: { t: Dict }) {
  return (
    <footer className="mx-auto max-w-7xl px-6 pb-10 pt-6">
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-faint">
        <span>{t.footer.builtFor}</span>
        <span aria-hidden="true">·</span>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
          {t.footer.github}
        </a>
      </p>
      <nav aria-label="Legal" className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-faint">
        <Link href="/privacy" className="hover:text-ink">
          {t.footer.privacy}
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms" className="hover:text-ink">
          {t.footer.terms}
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/how-it-works" className="hover:text-ink">
          {t.footer.howItWorks}
        </Link>
      </nav>
    </footer>
  );
}
