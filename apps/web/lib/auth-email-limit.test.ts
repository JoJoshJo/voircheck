import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ getDb: () => ({}) }));
import { allowAuthEmail, EMAIL_LIMITS, emailFrom, sendsEmail, tooManyEmails } from './auth/email-limit';

describe('auth emails are rate-limited before Neon Auth sends anything', () => {
  it('covers the endpoints that send email, not sign-in with a password', () => {
    expect(sendsEmail('sign-in/magic-link')).toBe(true);
    expect(sendsEmail('forget-password')).toBe(true);
    expect(sendsEmail('sign-in/email')).toBe(false);
    expect(sendsEmail('get-session')).toBe(false);
  });
  it('per recipient: the same address can’t be mailed over and over (case-insensitive)', () => {
    for (let i = 0; i < EMAIL_LIMITS.perAddressPerHour; i++) expect(allowAuthEmail(`198.51.100.${i}`, 'Victim@Example.com')).toBe(true);
    expect(allowAuthEmail('198.51.100.99', 'victim@example.com')).toBe(false);
  });
  it('per IP: one visitor can’t spray many addresses', () => {
    for (let i = 0; i < EMAIL_LIMITS.perIpPerHour; i++) expect(allowAuthEmail('203.0.113.50', `a${i}@example.com`)).toBe(true);
    expect(allowAuthEmail('203.0.113.50', 'another@example.com')).toBe(false);
  });
  it('reads the recipient without consuming the request; answers 429', async () => {
    const req = new Request('http://localhost/api/auth/sign-in/magic-link', { method: 'POST', body: JSON.stringify({ email: 'x@example.com' }) });
    expect(await emailFrom(req)).toBe('x@example.com');
    expect(await req.json()).toEqual({ email: 'x@example.com' });
    expect(tooManyEmails().status).toBe(429);
  });
});
