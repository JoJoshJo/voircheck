import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../lib/i18n';
import { SiteFooter } from './SiteFooter';

describe('SiteFooter', () => {
  it.each(['en', 'fr'] as const)('credits the hackathon, links GitHub, and keeps the legal links (%s)', (lang) => {
    const t = DICTS[lang];
    const html = renderToStaticMarkup(createElement(SiteFooter, { t }));
    expect(html).toContain(t.footer.builtFor);
    expect(html).toContain('github.com/JoJoshJo/voircheck');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/how-it-works"');
  });
});
