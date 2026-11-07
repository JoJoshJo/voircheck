'use client';

import { usePathname } from 'next/navigation';
import { setPublicLang } from '../app/actions';
import type { Lang } from '../lib/i18n';

/**
 * EN/FR switch for public pages (design-pass item 7). Posts the chosen language
 * to a server action that sets the vc_lang cookie and redirects back to the
 * current path, so the choice sticks. Keyboard- and no-JS-friendly (plain form
 * submit); the only client bit is reading the current path.
 */
export function LangSwitch({ current, labels }: { current: Lang; labels: { en: string; fr: string } }) {
  const path = usePathname() || '/';
  return (
    <form action={setPublicLang} className="inline-flex overflow-hidden rounded-full border border-line text-[12px] font-medium">
      <input type="hidden" name="next" value={path} />
      {(['en', 'fr'] as const).map((l) => (
        <button
          key={l}
          type="submit"
          name="lang"
          value={l}
          aria-label={l === 'en' ? labels.en : labels.fr}
          aria-pressed={current === l}
          className={`px-2.5 py-1 transition ${current === l ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
