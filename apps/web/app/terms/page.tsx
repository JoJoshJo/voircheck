import type { Metadata } from 'next';
import { LegalPageView } from '../../components/LegalPageView';
import { SiteHeader } from '../../components/SiteHeader';
import { DICTS } from '../../lib/i18n';
import { TERMS } from '../../lib/legal';
import { publicPageLang } from '../../lib/page-lang';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Terms', robots: { index: true, follow: true } };

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang, signedIn } = await publicPageLang((await searchParams).lang);
  return (
    <>
      <SiteHeader t={DICTS[lang]} signedIn={signedIn} />
      <LegalPageView page={TERMS[lang]} lang={lang} />
    </>
  );
}
