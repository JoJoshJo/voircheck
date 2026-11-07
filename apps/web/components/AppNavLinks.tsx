'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * App nav links with the current page highlighted (design-pass item 8).
 * `/app` matches exactly (so History/Settings don't light it up); the others
 * match by prefix. Server layout owns the Sign out form; this is only the links.
 */
export function AppNavLinks({ links }: { links: readonly (readonly [string, string, string])[] }) {
  const path = usePathname() || '';
  return (
    <>
      {links.map(([href, label, show]) => {
        const active = href === '/app' ? path === '/app' : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`${show} ${active ? 'font-medium text-ink' : 'hover:text-ink'}`.trim()}>
            {label}
          </Link>
        );
      })}
    </>
  );
}
