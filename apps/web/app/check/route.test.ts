import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoStartCheck, autoStartFor, CHECK_AUTO_COOKIE, CHECK_COOKIE } from '../../lib/workspace';

vi.mock('server-only', () => ({}));
const signedIn = { value: true };
vi.mock('../../lib/user', () => ({ getCurrentUser: async () => (signedIn.value ? { id: 'u1', email: 'j@example.com', name: 'J', isGuest: false } : null) }));

const STORE = 'https://shop.example/p/lamp?a=1';

async function visit(secFetchSite: string | null, url: string | null = STORE) {
  const { GET } = await import('./route');
  const headers = new Headers(secFetchSite ? { 'sec-fetch-site': secFetchSite } : {});
  const target = new URL('https://voircheck.com/check');
  if (url !== null) target.searchParams.set('url', url);
  const res = await GET(new NextRequest(target, { headers }));
  const cookie = (name: string) => res.cookies.get(name);
  return { res, check: cookie(CHECK_COOKIE), auto: cookie(CHECK_AUTO_COOKIE) };
}

describe('autoStartCheck', () => {
  it.each([
    ['none', true, true],
    ['none', false, false],
    ['cross-site', true, false],
    ['same-site', true, false],
    ['same-origin', true, false],
    [null, true, false],
  ])('Sec-Fetch-Site %s, signed in %s → auto %s', (secFetchSite, signed, expected) => {
    expect(autoStartCheck({ secFetchSite, signedIn: signed })).toBe(expected);
  });
});

describe('autoStartFor (/app)', () => {
  it('starts only the link the mark names', () => {
    expect(autoStartFor(STORE, STORE)).toBe(true);
    expect(autoStartFor(STORE, 'https://other.example/')).toBe(false);
    expect(autoStartFor(STORE, undefined)).toBe(false);
    expect(autoStartFor(STORE, '')).toBe(false);
    expect(autoStartFor(null, STORE)).toBe(false);
  });
});

describe('GET /check', () => {
  beforeEach(() => {
    signedIn.value = true;
    process.env.APP_URL = 'https://voircheck.com';
  });

  it('the person’s own navigation (none), signed in → link kept and marked to start (2 minutes)', async () => {
    const { res, check, auto } = await visit('none');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/app');
    expect(check?.value).toBe(STORE);
    expect(auto).toMatchObject({ value: STORE, maxAge: 120 });
  });

  it.each(['cross-site', 'same-site', 'same-origin', null])('Sec-Fetch-Site %s → manual: link in the box, no auto mark (any old one cleared)', async (site) => {
    const { check, auto } = await visit(site);
    expect(check?.value).toBe(STORE);
    expect(auto).toMatchObject({ value: '', maxAge: 0 });
  });

  it('signed out → manual even from the extension (press Check after sign-in)', async () => {
    signedIn.value = false;
    const { check, auto } = await visit('none');
    expect(check?.value).toBe(STORE);
    expect(auto).toMatchObject({ value: '', maxAge: 0 });
  });

  it('stays on the host that saved the cookie, whatever APP_URL says (Nov 11: the link was lost on onrender.com)', async () => {
    process.env.APP_URL = 'https://voircheck-web.onrender.com';
    const { res, check } = await visit('none');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/app');
    expect(check?.value).toBe(STORE);
  });

  it('an invalid link sets nothing', async () => {
    for (const bad of ['javascript:alert(1)', 'https://user:pw@shop.example/', null]) {
      const { check, auto } = await visit('none', bad);
      expect(check).toBeUndefined();
      expect(auto).toBeUndefined();
    }
  });
});
