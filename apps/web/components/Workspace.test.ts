import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../lib/i18n';
import { Workspace } from './Workspace';

const render = (lang: 'en' | 'fr' = 'en', initialDemoMode = true) =>
  renderToStaticMarkup(createElement(Workspace, { t: DICTS[lang], lang, clientId: 'sb', initialDemoMode, autopay: false, initialCheck: null, autoStart: false }));

describe('workspace layout', () => {
  it('is one column below lg, so a long link or result can’t widen the page on a phone', () => {
    expect(render()).toMatch(/class="grid grid-cols-1 gap-6 lg:grid-cols-/);
  });
});
