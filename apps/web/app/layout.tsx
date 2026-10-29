import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SiteFooter } from '../components/SiteFooter';
import { DICTS } from '../lib/i18n';
import { guessLang } from '../lib/user';
import './globals.css';

// Fallback only: the system font stack comes first (spec 5.12). Never embed SF Pro.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'VoirCheck', template: '%s · VoirCheck' },
  description: 'Before your agent pays, VoirCheck sees who it’s paying.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await guessLang();
  return (
    <html lang={lang} className={inter.variable}>
      <body className="min-h-screen bg-white text-ink">
        {children}
        <SiteFooter t={DICTS[lang]} />
      </body>
    </html>
  );
}
