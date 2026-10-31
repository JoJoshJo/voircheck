import { describe, expect, it } from 'vitest';
import { detectBlockedPage } from './blocked-page';

const page = (visibleText: string, over: { title?: string; h1?: string | null; httpStatus?: number | null } = {}) => ({
  title: over.title ?? '',
  h1: over.h1 ?? null,
  visibleText,
  httpStatus: over.httpStatus ?? 200,
});

describe('bot-check / interstitial detection', () => {
  it.each([
    ['generic (heizungug.de)', page('Checking your browser before accessing heizungug.de. This process is automatic.', { h1: 'Checking your browser before accessing heizungug.de' })],
    ['Cloudflare', page('www.shop.test Verify you are human by completing the action below. www.shop.test needs to review the security of your connection before proceeding. Ray ID: 8f2a Performance & security by Cloudflare', { title: 'Just a moment...', httpStatus: 403 })],
    ['Cloudflare (old)', page('Please enable JavaScript and cookies to continue', { title: 'Attention Required! | Cloudflare' })],
    ['DDoS-Guard', page('Checking your browser before accessing shop.test. DDoS-Guard', { title: 'DDoS-Guard' })],
    ['Imperva', page('Pardon Our Interruption. As you were browsing something about your browser made us think you were a bot.')],
    ['PerimeterX', page('Press & Hold to confirm you are a human (and not a bot).')],
    ['DE', page('Wir überprüfen Ihren Browser. Bitte warten Sie einen Moment.')],
    ['FR', page('Vérification de votre navigateur avant d’accéder au site. Veuillez patienter.')],
  ])('%s → blocked by a bot check', (_, p) => {
    expect(detectBlockedPage(p)).toMatchObject({ kind: 'bot_check' });
    expect(detectBlockedPage(p)!.message).toMatch(/^blocked by a bot check/);
  });

  it('short 403/429 pages are bot walls; short 5xx/404 pages are error pages', () => {
    expect(detectBlockedPage(page('Access denied. You do not have permission to access this page.', { httpStatus: 403 }))?.message).toBe('blocked by a bot check (HTTP 403)');
    expect(detectBlockedPage(page('502 Bad Gateway nginx — the upstream server is not answering.', { httpStatus: 502 }))).toMatchObject({ kind: 'error_page' });
  });

  it('empty shells (no visible content) are not the store', () => {
    expect(detectBlockedPage(page('  Loading…  '))).toMatchObject({ kind: 'empty_page' });
  });

  it('a real shop page is never flagged, even if it mentions captcha / Cloudflare in long text', () => {
    const shop = 'Willkommen bei unserem Shop. '.repeat(40) + 'Verify you are human — our contact form uses a captcha. Performance & security by Cloudflare.';
    expect(detectBlockedPage(page(shop))).toBeNull();
    expect(detectBlockedPage(page('Fictional demo store. Velbrook Supply. Zephlet Buds $59.00 Clear calls, all-day battery.'))).toBeNull();
  });
});
