import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let path = '/app';
vi.mock('next/navigation', () => ({ usePathname: () => path }));

import { AppNavLinks } from './AppNavLinks';

const LINKS = [
  ['/app', 'Workspace', ''],
  ['/app/history', 'History', ''],
  ['/app/settings', 'Settings', ''],
] as const;

describe('AppNavLinks', () => {
  it('marks the current page, and /app does not light up on a sub-page', () => {
    path = '/app/history';
    const html = renderToStaticMarkup(createElement(AppNavLinks, { links: LINKS }));
    // History is current; Workspace (/app) is not, even though the path starts with /app.
    expect(html).toMatch(/aria-current="page"[^>]*href="\/app\/history"/);
    expect(html).not.toMatch(/aria-current="page"[^>]*href="\/app"(?!\/)/);
  });

  it('marks Workspace only on exactly /app', () => {
    path = '/app';
    const html = renderToStaticMarkup(createElement(AppNavLinks, { links: LINKS }));
    expect(html).toMatch(/aria-current="page"[^>]*href="\/app"(?!\/)/);
    expect(html).not.toMatch(/aria-current="page"[^>]*href="\/app\/settings"/);
  });
});
