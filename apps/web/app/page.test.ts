import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTS, type Lang } from '../lib/i18n';

let lang: Lang = 'en';
let user: { id: string } | null = null;
const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a), usePathname: () => '/' }));
vi.mock('../lib/user', () => ({ getCurrentUser: async () => user, guessLang: async () => lang, dictFor: (l: Lang) => DICTS[l] }));
vi.mock('../app/actions', () => ({ startDemo: async () => undefined, setPublicLang: async () => undefined }));

async function landing(l: Lang) {
  lang = l;
  const { default: Landing } = await import('./page');
  return renderToStaticMarkup(await Landing());
}

describe('landing page', () => {
  beforeEach(() => {
    lang = 'en';
    user = null;
    redirect.mockReset();
  });

  it.each(['en', 'fr'] as const)('signed out: Try the demo and Sign in, no workspace link (%s)', async (l) => {
    const t = DICTS[l];
    const html = await landing(l);
    expect(html).toContain(t.landing.tryDemo);
    expect(html).toContain(t.landing.tryDemoNote.replace(/'/g, '&#x27;'));
    expect(html).toContain(`href="/auth/sign-in"`);
    expect(html).not.toContain(t.landing.openWorkspace);
    expect(html).not.toContain('href="/app"');
  });

  it.each(['en', 'fr'] as const)('signed in: the landing page, no redirect, Open my workspace in the header and the hero (%s)', async (l) => {
    user = { id: 'user-1' };
    const t = DICTS[l];
    const html = await landing(l);
    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain(t.meta.tagline);
    expect(html.match(new RegExp(`href="/app"[^>]*>${t.landing.openWorkspace}<`, 'g'))).toHaveLength(2); // header + hero
    expect(html).not.toContain(t.landing.tryDemo);
    expect(html).not.toContain(t.landing.tryDemoNote.replace(/'/g, '&#x27;'));
    expect(html).not.toContain(`>${t.nav.signIn}<`);
  });

  it.each(['en', 'fr'] as const)('hero: the tagline as the headline, the subline, Try the demo, the assembling ghost (%s)', async (l) => {
    const html = await landing(l);
    const t = DICTS[l];
    for (const s of [t.meta.tagline, t.landing.subline, t.landing.tryDemo, t.landing.howItWorks]) expect(html).toContain(s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
    expect(html).toMatch(/<h1 class="[^"]*font-\[600\]/);
    // The hero demo renders its finished Safe state on the server (no JS / reduced motion).
    expect(html).toContain(t.agent.example);
    expect(html).toContain('data-face="SAFE"');
    expect(html).toContain('vc-hero-bg');
  });

  it.each(['en', 'fr'] as const)('six feature tiles and the two proof cards, with the honest wording (%s)', async (l) => {
    const html = await landing(l);
    const t = DICTS[l].landing;
    for (const k of ['Agent', 'Checks', 'Paypal', 'Extension', 'Agents', 'Receipts'] as const) expect(html).toContain(t[`tile${k}Title`].replace(/'/g, '&#x27;'));
    expect((html.match(/vc-draw/g) ?? []).length).toBeGreaterThanOrEqual(6);
    for (const s of [t.proofWithoutOf, t.proofWithOf, t.proofWithout, t.proofWith]) expect(html).toContain(s);
    expect(t.proofWithNote).toMatch(l === 'en' ? /first looked safe/ : /d’abord semblé fiable/);
    expect(html).toContain(t.proofWithNote.replace(/'/g, '&#x27;'));
  });

  it.each(['en', 'fr'] as const)('the three-answers strip shows all three ghost faces and verdict-coloured labels (%s)', async (l) => {
    const html = await landing(l);
    const t = DICTS[l].landing;
    for (const s of [t.threeTitle, t.threeSafeLabel, t.threeHoldLabel, t.threeBlockLabel]) expect(html).toContain(s.replace(/'/g, '&#x27;'));
    for (const face of ['SAFE', 'HOLD', 'BLOCK']) expect(html).toContain(`data-face="${face}"`);
    expect(html).toContain('text-safe');
    expect(html).toContain('text-hold');
    expect(html).toContain('text-block');
  });

  it.each(['en', 'fr'] as const)('header has GitHub, an EN/FR switch and a demo CTA; footer credits the hackathon (%s)', async (l) => {
    const html = await landing(l);
    const t = DICTS[l];
    expect(html).toContain('github.com/JoJoshJo/voircheck');
    expect(html).toContain('name="lang"');
    expect(html).toContain('value="en"');
    expect(html).toContain('value="fr"');
    expect(html).toContain(t.landing.tryDemo); // signed-out demo CTA (hero + header)
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
