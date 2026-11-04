import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../lib/i18n';
import { AgentTokens } from './AgentTokens';

const render = (lang: 'en' | 'fr', guest: boolean) =>
  renderToStaticMarkup(createElement(AgentTokens, { t: DICTS[lang].settings.agent, endpoint: 'https://voircheck.com/api/mcp', guest, tokens: [], createAction: async () => null, revokeAction: async () => {} }));

describe('Settings → Connect an AI agent', () => {
  it('guest (demo) accounts see "Sign up to connect an AI agent." and no create form (EN and FR)', () => {
    for (const [lang, line] of [['en', 'Sign up to connect an AI agent.'], ['fr', 'Créez un compte pour connecter un agent IA.']] as const) {
      const html = render(lang, true);
      expect(html).toContain(line);
      expect(html).not.toContain('<form');
      expect(html).not.toContain(DICTS[lang].settings.agent.create);
    }
  });
  it('signed-up accounts get the create form', () => {
    const html = render('en', false);
    expect(html).toContain('<form');
    expect(html).not.toContain('Sign up to connect an AI agent.');
  });
});
