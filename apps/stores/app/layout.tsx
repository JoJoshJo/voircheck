import type { Metadata } from 'next';
import './globals.css';

// Demo stores are never indexed (spec 5.8).
export const metadata: Metadata = {
  title: 'VoirCheck demo stores',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
