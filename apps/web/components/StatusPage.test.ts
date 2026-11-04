import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DICTS } from '../lib/i18n';

vi.mock('../lib/user', () => ({ guessLang: async () => 'fr' }));

describe('not-found and error pages', () => {
  it('not found: the ghost, 404, the line and the way back, in the visitor’s language', async () => {
    const { default: NotFound } = await import('../app/not-found');
    const html = renderToStaticMarkup(await NotFound());
    for (const s of ['404', 'Rien ici', 'ne vous est pas destinée', 'Retour à VoirCheck', 'href="/"', 'aria-hidden="true"']) expect(html).toContain(s);
  });

  it('error: Try again + Back to VoirCheck, never the error message itself', async () => {
    const { default: ErrorPage } = await import('../app/error');
    const html = renderToStaticMarkup(createElement(ErrorPage, { error: new Error('db password in here'), reset: () => undefined }));
    for (const s of ['Something went wrong', 'Try again', 'Back to VoirCheck']) expect(html).toContain(s);
    expect(html).not.toContain('db password');
  });

  it('every string exists in both languages', () => {
    expect(Object.keys(DICTS.fr.errors)).toEqual(Object.keys(DICTS.en.errors));
  });
});
