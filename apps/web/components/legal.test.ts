import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../lib/i18n';
import { CONTACT_EMAIL, LEGAL_LAST_UPDATED, PRIVACY, TERMS } from '../lib/legal';
import { LegalPageView } from './LegalPageView';
import { SiteFooter } from './SiteFooter';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('Privacy and Terms pages', () => {
  it.each(['en', 'fr'] as const)('render in %s with the last-updated date and the contact email', (lang) => {
    for (const page of [PRIVACY[lang], TERMS[lang]]) {
      const html = render(createElement(LegalPageView, { page, lang }));
      expect(html).toContain(`<h1`);
      expect(text(html)).toContain(page.title);
      expect(text(html)).toContain(LEGAL_LAST_UPDATED);
      expect(text(html)).toContain(CONTACT_EMAIL);
    }
  });

  it('EN and FR have the same structure', () => {
    for (const [en, fr] of [[PRIVACY.en, PRIVACY.fr], [TERMS.en, TERMS.fr]] as const) {
      expect(fr.sections.length).toBe(en.sections.length);
      fr.sections.forEach((s, i) => {
        expect(s.items?.length ?? 0).toBe(en.sections[i]!.items?.length ?? 0);
        expect(s.paragraphs?.length ?? 0).toBe(en.sections[i]!.paragraphs?.length ?? 0);
      });
    }
  });

  it('the only email address on the pages is the CONTACT_EMAIL constant', () => {
    const all = JSON.stringify([PRIVACY, TERMS]);
    const emails = new Set(all.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g));
    expect([...emails]).toEqual([CONTACT_EMAIL]);
  });

  it('privacy says what the code does: sandbox, Limited Use, no tracking cookies, AI + Channel3 not live yet', () => {
    const p = JSON.stringify(PRIVACY.en);
    for (const must of ['PayPal AI Hackathon', 'sandbox', 'Limited Use', 'No advertising, analytics or tracking cookies', '__Secure-neon-auth', 'vc_lang', 'vc_demo', '/r/', 'IP address']) {
      expect(p).toContain(must);
    }
    expect(PRIVACY.en.sections.flatMap((s) => s.items ?? []).find((i) => i.startsWith('Anthropic'))).toContain('will');
    expect(PRIVACY.en.sections.flatMap((s) => s.items ?? []).find((i) => i.startsWith('Channel3'))).toContain('not live yet');
  });

  it('privacy says PayPal notifications keep only payment status details (no buyer PII)', () => {
    for (const lang of ['en', 'fr'] as const) {
      const p = JSON.stringify(PRIVACY[lang]);
      expect(p).not.toMatch(/sandbox buyer account|compte acheteur sandbox/);
    }
    expect(JSON.stringify(PRIVACY.en)).toContain('we keep only payment status details');
  });

  it('terms cover as-is, sandbox only, verdicts not guarantees, fictional demo stores, fair use and MIT', () => {
    const t = JSON.stringify(TERMS.en);
    for (const must of ['without any warranty', 'sandbox', 'not guarantees', 'fictional', 'Don’t use it to attack', 'MIT License']) expect(t).toContain(must);
  });
});

describe('footer', () => {
  it.each(['en', 'fr'] as const)('links to Privacy, Terms and How it works (%s)', (lang) => {
    const html = render(createElement(SiteFooter, { t: DICTS[lang] }));
    for (const href of ['/privacy', '/terms', '/how-it-works']) expect(html).toContain(`href="${href}"`);
    expect(text(html)).toContain(DICTS[lang].footer.privacy);
    expect(text(html)).toContain(DICTS[lang].footer.terms);
  });
});
