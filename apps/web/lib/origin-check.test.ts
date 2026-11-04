import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crossOriginRefusal, CrossOriginError, isOwnOrigin, isSameOriginRequest } from './origin-check';

const prod = { NODE_ENV: 'production', APP_URL: 'https://voircheck-web.onrender.com', VOIRCHECK_APP_URL: 'https://voircheck.com' };
const dev = { NODE_ENV: 'development' };
const h = (o: Record<string, string>) => new Headers(o);

describe('Origin check for state-changing requests', () => {
  it('our own sites pass in production', () => {
    for (const o of ['https://voircheck.com', 'https://voircheck-web.onrender.com']) expect(isSameOriginRequest(h({ origin: o }), prod)).toBe(true);
  });
  it('other sites, look-alikes, http, other ports and "null" origins are refused in production', () => {
    for (const o of ['https://evil.example', 'https://voircheck.com.evil.example', 'https://evilvoircheck.com', 'http://voircheck.com', 'https://voircheck.com:8443', 'null', 'http://localhost:3000']) {
      expect(isSameOriginRequest(h({ origin: o }), prod)).toBe(false);
    }
  });
  it('no Origin: the Referer origin counts; neither → refused', () => {
    expect(isSameOriginRequest(h({ referer: 'https://voircheck.com/app/settings' }), prod)).toBe(true);
    expect(isSameOriginRequest(h({ referer: 'https://evil.example/x' }), prod)).toBe(false);
    expect(isSameOriginRequest(h({}), prod)).toBe(false);
  });
  it('local dev: localhost and 127.0.0.1 on any port, still nothing else', () => {
    expect(isSameOriginRequest(h({ origin: 'http://localhost:3000' }), dev)).toBe(true);
    expect(isSameOriginRequest(h({ origin: 'http://127.0.0.1:4000' }), dev)).toBe(true);
    expect(isSameOriginRequest(h({ origin: 'https://evil.example' }), dev)).toBe(false);
    expect(isOwnOrigin('http://localhost.evil.example', dev)).toBe(false);
  });
  it('route handlers get a 403 for a cross-site request and null for our own', () => {
    expect(crossOriginRefusal(new Request('https://voircheck.com/api/pay/refund', { method: 'POST', headers: { origin: 'https://evil.example' } }))?.status).toBe(403);
    vi.stubEnv('NODE_ENV', 'production');
    expect(crossOriginRefusal(new Request('https://voircheck.com/api/pay/refund', { method: 'POST', headers: { origin: 'https://voircheck.com' } }))).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('cross-site POSTs are refused before anything runs', () => {
  const evil = { origin: 'https://evil.example', 'content-type': 'application/json' };
  const getCurrentUser = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    getCurrentUser.mockReset();
    vi.doMock('server-only', () => ({}));
    vi.doMock('../lib/user', () => ({ getCurrentUser, getProfile: vi.fn(), LANG_COOKIE: 'l' }));
    vi.doMock('./user', () => ({ getCurrentUser, getProfile: vi.fn(), LANG_COOKIE: 'l' }));
  });

  it('pay (refund, capture…), scans and the agent: 403 without reading the session', async () => {
    const pay = await import('../app/api/pay/[action]/route');
    const res = await pay.POST(new Request('http://localhost:3000/api/pay/refund', { method: 'POST', headers: evil, body: JSON.stringify({ paymentId: 'p1' }) }), { params: Promise.resolve({ action: 'refund' }) });
    expect(res.status).toBe(403);
    const scans = await import('../app/api/scans/route');
    expect((await scans.POST(new Request('http://localhost:3000/api/scans', { method: 'POST', headers: evil, body: '{}' }))).status).toBe(403);
    const agent = await import('../app/api/agent/route');
    expect((await agent.POST(new Request('http://localhost:3000/api/agent', { method: 'POST', headers: evil, body: '{}' }))).status).toBe(403);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('server actions (agent token create/revoke, settings, sign-out…) throw before reading the session', async () => {
    vi.doMock('next/headers', () => ({ headers: async () => new Headers(evil), cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
    const settings = await import('../app/app/settings/actions');
    const form = new FormData();
    form.set('id', '00000000-0000-4000-8000-000000000000');
    await expect(settings.createAgentToken(null, form)).rejects.toBeInstanceOf(Error);
    await expect(settings.revokeAgentToken(form)).rejects.toThrow('cross-origin request refused');
    await expect(settings.saveSettings(form)).rejects.toThrow('cross-origin request refused');
    await expect(settings.removeSavedPayPal()).rejects.toThrow('cross-origin request refused');
    const getAuth = vi.fn();
    vi.doMock('../lib/auth/server', () => ({ getAuth }));
    const app = await import('../app/actions');
    await expect(app.startDemo()).rejects.toThrow('cross-origin request refused');
    await expect(app.signOut()).rejects.toThrow('cross-origin request refused');
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
    expect(new CrossOriginError().name).toBe('CrossOriginError');
  });
});
