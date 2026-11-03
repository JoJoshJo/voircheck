import { describe, expect, it } from 'vitest';
import { pendingCheckUrl } from '../web/lib/workspace';
import { APP_ORIGIN, checkableUrl, checkLink, hostOf } from './link.js';

describe('checkableUrl', () => {
  it('accepts http(s) store pages and drops the #fragment', () => {
    expect(checkableUrl('https://shop.example/p/lamp?colour=oak')).toBe('https://shop.example/p/lamp?colour=oak');
    expect(checkableUrl('http://shop.example/')).toBe('http://shop.example/');
    expect(checkableUrl('https://shop.example/p/lamp#reviews')).toBe('https://shop.example/p/lamp');
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://abc/popup.html',
    'file:///Users/me/a.html',
    'about:blank',
    'data:text/html,hi',
    'javascript:alert(1)',
    'view-source:https://shop.example/',
    'edge://settings',
    'ftp://shop.example/',
    'https://user:pass@shop.example/',
    'https://user@shop.example/',
    'not a url',
    '',
  ])('rejects %s', (raw) => {
    expect(checkableUrl(raw)).toBeNull();
  });

  it('rejects missing links and links over 2048 characters', () => {
    expect(checkableUrl(undefined)).toBeNull();
    expect(checkableUrl(null)).toBeNull();
    expect(checkableUrl(`https://shop.example/${'a'.repeat(2048)}`)).toBeNull();
  });

  it('rejects VoirCheck’s own site', () => {
    for (const raw of ['https://voircheck.com/app', 'https://www.voircheck.com/', 'https://VOIRCHECK.com/r/x', 'https://voircheck-web.onrender.com/app']) {
      expect(checkableUrl(raw)).toBeNull();
    }
    expect(checkableUrl('https://notvoircheck.com/')).toBe('https://notvoircheck.com/');
  });
});

describe('checkLink', () => {
  it('points at /check on the hard-coded app origin, with the link encoded', () => {
    const link = checkLink('https://shop.example/p/lamp?a=1&b=two words#x');
    expect(link).toBe(`${APP_ORIGIN}/check?url=https%3A%2F%2Fshop.example%2Fp%2Flamp%3Fa%3D1%26b%3Dtwo%2520words`);
    expect(new URL(link!).origin).toBe('https://voircheck.com');
  });

  it('round-trips through the web app’s /check validation unchanged', () => {
    for (const raw of ['https://shop.example/p/lamp?a=1&b=2', 'http://xn--bcher-kva.example/ü?q=ça', 'https://shop.example/a%2Fb']) {
      const sent = new URL(checkLink(raw)!).searchParams.get('url');
      expect(pendingCheckUrl(sent)).toBe(checkableUrl(raw));
    }
  });

  it('gives nothing for a page that can’t be checked', () => {
    expect(checkLink('chrome://newtab')).toBeNull();
  });
});

describe('hostOf', () => {
  it('shows the host without www.', () => {
    expect(hostOf('https://www.shop.example/p')).toBe('shop.example');
    expect(hostOf('https://outlet.shop.example/p')).toBe('outlet.shop.example');
  });
});
