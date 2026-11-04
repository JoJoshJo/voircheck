import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTS, type Lang } from '../lib/i18n';

let lang: Lang = 'en';
vi.mock('../lib/user', () => ({ getCurrentUser: async () => null, guessLang: async () => lang, dictFor: (l: Lang) => DICTS[l] }));
vi.mock('../app/actions', () => ({ startDemo: async () => undefined }));

async function landing(l: Lang) {
  lang = l;
  const { default: Landing } = await import('./page');
  return renderToStaticMarkup(await Landing());
}

describe('landing page', () => {
  beforeEach(() => {
    lang = 'en';
  });

  it.each(['en', 'fr'] as const)('hero: the tagline as the headline, the subline, Try the demo, the assembling ghost (%s)', async (l) => {
    const html = await landing(l);
    const t = DICTS[l];
    for (const s of [t.meta.tagline, t.landing.kicker, t.landing.subline, t.landing.tryDemo, t.landing.howItWorks]) expect(html).toContain(s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
    expect(html).toMatch(/<h1 class="[^"]*font-\[600\]/);
    expect(html).toContain('class="vc-asm vc-hero-ghost');
    expect(html).toContain('data-face="SAFE"');
    expect(html).toContain('vc-hero-bg');
  });

  it.each(['en', 'fr'] as const)('six feature tiles and the two proof cards, with the honest wording (%s)', async (l) => {
    const html = await landing(l);
    const t = DICTS[l].landing;
    for (const k of ['Agent', 'Checks', 'Paypal', 'Extension', 'Agents', 'Receipts'] as const) expect(html).toContain(t[`tile${k}Title`].replace(/'/g, '&#x27;'));
    expect((html.match(/vc-draw/g) ?? []).length).toBeGreaterThanOrEqual(6);
    for (const s of [t.proofWithoutOf, t.proofWithOf, t.proofWithout, t.proofWith]) expect(html).toContain(s);
    expect(t.proofWithBody).toMatch(l === 'en' ? /One first scored Safe/ : /d’abord obtenu Fiable/);
  });

  it('content that fades in on scroll is visible without JavaScript', async () => {
    const html = await landing('en');
    expect(html).toContain('<noscript><style>.vc-rv{opacity:1!important');
    expect(html).toContain('vc-rv');
  });

  it('every landing string exists in both languages', () => {
    expect(Object.keys(DICTS.fr.landing)).toEqual(Object.keys(DICTS.en.landing));
  });
});
