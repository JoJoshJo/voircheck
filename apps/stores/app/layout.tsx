import type { Metadata } from 'next';
import './globals.css';

// Demo stores are never indexed (spec 5.8); robots.txt also disallows everything.
export const metadata: Metadata = {
  title: 'Fictional demo stores · VoirCheck',
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
