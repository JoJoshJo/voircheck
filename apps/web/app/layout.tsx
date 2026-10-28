import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VoirCheck',
  description: "Before your agent pays, VoirCheck sees who it's paying.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
