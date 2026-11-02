import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySetCookies, forwardSession, SESSION_COOKIE } from './auth/session-refresh';

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ getDb: () => ({}) }));
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
// The real module loads the Neon SDK, which needs the Next.js runtime.
vi.mock('./auth/server', () => ({ AuthConfigError: class AuthConfigError extends Error {}, getAuth: () => ({ getSession }) }));

const DATA = '__Secure-neon-auth.local.session_data';
const refresh = [`${SESSION_COOKIE}=tok.renewed; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`, `${DATA}=jwt.fresh; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Lax`];
const page = (path: string, cookie = `${SESSION_COOKIE}=tok; ${DATA}=jwt.expired; vc_lang=fr`) => new Request(`http://localhost:3000${path}`, { headers: { cookie } });
const sdkNext = (cookies: string[]) => {
  const h = new Headers({ 'x-middleware-next': '1' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { headers: h });
};
const sdkRedirect = (to: string, cookies: string[] = []) => {
  const h = new Headers({ location: to });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 307, headers: h });
};

describe('applySetCookies: the cookies a page request carries after the proxy refreshed the session', () => {
  it('renewed values replace old ones, other cookies stay', () => {
    expect(applySetCookies(`${SESSION_COOKIE}=tok; ${DATA}=jwt.expired; vc_lang=fr`, refresh)).toBe(`${SESSION_COOKIE}=tok.renewed; ${DATA}=jwt.fresh; vc_lang=fr`);
  });
  it('Max-Age=0, a past Expires or an empty value removes the cookie', () => {
    const cleared = [`${DATA}=; Path=/; Max-Age=0`, `${SESSION_COOKIE}=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`];
    expect(applySetCookies(`${SESSION_COOKIE}=tok; ${DATA}=jwt; vc_lang=en`, cleared)).toBe('vc_lang=en');
  });
});

describe('forwardSession: the refresh happens in the proxy, so a page never has to write a cookie', () => {
  it('signed in: the browser gets the refreshed cookies AND the page request carries them', () => {
    const out = forwardSession(page('/'), sdkNext(refresh), { protectedRoute: false });
    expect(out.headers.get('x-middleware-next')).toBe('1');
    expect(out.headers.getSetCookie()).toEqual(refresh);
    expect(out.headers.get('x-middleware-request-cookie')).toBe(`${SESSION_COOKIE}=tok.renewed; ${DATA}=jwt.fresh; vc_lang=fr`);
    expect(out.headers.get('x-middleware-request-x-neon-auth-middleware')).toBe('true');
  });
  it('public page, session gone: no sign-in redirect, the page renders signed out with the stale cookies cleared', () => {
    const out = forwardSession(page('/how-it-works'), sdkRedirect('http://localhost:3000/auth/sign-in', [`${DATA}=; Path=/; Max-Age=0`]), { protectedRoute: false });
    expect(out.status).toBe(200);
    expect(out.headers.get('location')).toBeNull();
    expect(out.headers.get('x-middleware-request-cookie')).toBe(`${SESSION_COOKIE}=tok; vc_lang=fr`);
  });
  it('signed-in area, session gone: the sign-in redirect stays', () => {
    const sdk = sdkRedirect('http://localhost:3000/auth/sign-in');
    expect(forwardSession(page('/app'), sdk, { protectedRoute: true })).toBe(sdk);
  });
  it('other redirects (Google sign-in completing) pass through unchanged', () => {
    const sdk = sdkRedirect('http://localhost:3000/app?x=1', refresh);
    expect(forwardSession(page('/'), sdk, { protectedRoute: false })).toBe(sdk);
  });
});

describe('getCurrentUser: a failed session read is "signed out", never a 500', () => {
  beforeEach(() => {
    getSession.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  it('the SDK writing a cookie during render (Next.js forbids it) → null, logged', async () => {
    const { getCurrentUser } = await import('./user');
    getSession.mockRejectedValue(new Error('Cookies can only be modified in a Server Action or Route Handler.'));
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/treating as signed out/));
  });
  it('a missing auth config still fails loudly', async () => {
    const { getCurrentUser } = await import('./user');
    const { AuthConfigError } = await import('./auth/server');
    getSession.mockRejectedValue(new AuthConfigError('Neon Auth is not configured'));
    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthConfigError);
  });
  it('a normal session → the user (guest accounts flagged)', async () => {
    const { getCurrentUser } = await import('./user');
    getSession.mockResolvedValue({ data: { user: { id: 'u1', email: 'x@guest.voircheck.invalid', name: 'Guest' } } });
    await expect(getCurrentUser()).resolves.toEqual({ id: 'u1', email: 'x@guest.voircheck.invalid', name: 'Guest', isGuest: true });
  });
});
