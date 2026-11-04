import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shareCard } from './og';

const APP = join(__dirname, '..', 'app');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('share cards', () => {
  const withCard = sources(APP)
    .filter((p) => /shareCard\(|openGraph|twitter:/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(APP, p))
    .sort();

  it('only on public pages and (generic) receipts; never under /app or in the root layout', () => {
    expect(withCard).toEqual(['how-it-works/page.tsx', 'page.tsx', 'privacy/page.tsx', 'r/[slug]/page.tsx', 'terms/page.tsx']);
  });

  it('the card is the fixed image and tagline, with a large Twitter card', () => {
    const c = shareCard('A VoirCheck Trust Receipt');
    expect(c.openGraph).toMatchObject({ title: 'A VoirCheck Trust Receipt', images: [{ url: '/og.png', width: 1200, height: 630 }] });
    expect(c.twitter).toMatchObject({ card: 'summary_large_image' });
  });
});
