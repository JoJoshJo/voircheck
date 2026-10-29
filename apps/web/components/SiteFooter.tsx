import Link from 'next/link';
import type { Dict } from '../lib/i18n';

/** Small footer on every page: Privacy · Terms · How it works. */
export function SiteFooter({ t }: { t: Dict }) {
  return (
    <footer className="mx-auto max-w-7xl px-6 pb-10 pt-6">
      <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-faint">
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
