'use client';

import { useEffect, useState } from 'react';
import { StatusPage } from '../components/StatusPage';
import { btnSecondary } from '../components/ui';
import { DICTS, isLang, type Lang } from '../lib/i18n';

/** Errors below the root layout. The language is the one the layout put on <html>; the error itself is never shown. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => {
    const l = document.documentElement.lang;
    if (isLang(l)) setLang(l);
  }, []);
  const t = DICTS[lang];
  return (
    <StatusPage mood="BLOCK" title={t.errors.errorTitle} body={t.errors.errorBody} home={t.errors.home}>
      <button type="button" onClick={reset} className={btnSecondary}>
        {t.errors.retry}
      </button>
    </StatusPage>
  );
}
