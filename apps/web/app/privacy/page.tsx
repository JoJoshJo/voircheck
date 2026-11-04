import type { Metadata } from 'next';
import { LegalPageView } from '../../components/LegalPageView';
import { SiteHeader } from '../../components/SiteHeader';
import { DICTS } from '../../lib/i18n';
import { shareCard } from '../../lib/og';
import { PRIVACY } from '../../lib/legal';
import { publicPageLang } from '../../lib/page-lang';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Privacy', robots: { index: true, follow: true }, ...shareCard('VoirCheck privacy') };

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang, signedIn } = await publicPageLang((await searchParams).lang);
  return (
    <>
      <SiteHeader t={DICTS[lang]} signedIn={signedIn} />
      <LegalPageView page={PRIVACY[lang]} lang={lang} />
    </>
  );
}
