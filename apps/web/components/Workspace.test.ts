import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoTryLinks } from '../lib/demo-links';
import { DICTS } from '../lib/i18n';
import { BuyCard, Workspace } from './Workspace';

const render = (lang: 'en' | 'fr' = 'en', initialDemoMode = true) =>
  renderToStaticMarkup(createElement(Workspace, { t: DICTS[lang], lang, clientId: 'sb', initialDemoMode, autopay: false, initialCheck: null, autoStart: false, demoLinks: demoTryLinks() }));

describe('workspace layout', () => {
  it('is one column below lg, so a long link or result can’t widen the page on a phone', () => {
    expect(render()).toMatch(/class="grid grid-cols-1 gap-6 lg:grid-cols-/);
  });
});

describe('first visit in Demo mode', () => {
  it.each(['en', 'fr'] as const)('says what Demo mode does and offers safe store / scam store / ask the agent (%s)', (lang) => {
    const html = render(lang);
    const w = DICTS[lang].workspace;
    for (const text of [w.demoModeLine, w.tryTitle, w.trySafe, w.tryScam, w.tryAgent]) expect(html).toContain(text);
  });

  it('shows neither the line nor the chips with Demo mode off', () => {
    const html = render('en', false);
    expect(html).not.toContain(DICTS.en.workspace.demoModeLine);
    expect(html).not.toContain('data-testid="try-demo"');
  });

  it('the chips link to the fictional Velbrook pair (legit first), on the configured base URL', () => {
    expect(demoTryLinks()).toEqual({
      safe: 'https://voircheck-stores.onrender.com/s/velbrook-supply/products/zephlet-buds',
      scam: 'https://voircheck-stores.onrender.com/s/velbrook-outlet-deals/products/zephlet-buds',
    });
    expect(demoTryLinks('http://localhost:4000/').safe).toBe('http://localhost:4000/s/velbrook-supply/products/zephlet-buds');
  });
});

describe('buying from a BLOCK result', () => {
  const scan = { id: 'scan-1', url: 'https://x.test/', domain: 'x.test', verdict: 'BLOCK' as const, score: 100, signals: [], hardRules: [], cantVerify: null, scannedAt: '2026-11-04T10:00:00Z' };
  const candidate = { id: 'c-1', storeName: 'Velbrook-Outlet Deals', productTitle: 'Zephlet Buds', price: '23.00', currency: 'USD' };

  it.each(['en', 'fr'] as const)('says VoirCheck won’t pay, links the evidence and keeps "Pay anyway" behind a click (%s)', (lang) => {
    const html = renderToStaticMarkup(createElement(BuyCard, { t: DICTS[lang], lang, clientId: 'sb', scan, candidate, autopay: false }));
    expect(html).toContain(DICTS[lang].pay.blockedTitle);
    expect(html).toContain('href="/app/scans/scan-1"');
    expect(html).toContain(DICTS[lang].pay.blockedAnyway);
    expect(html).not.toContain(candidate.price);
  });
});
