import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const h = (o: Record<string, string>) => new Headers(o);

describe('clientIp: the address per-IP limits use', () => {
  it("Cloudflare's header wins over a forged X-Forwarded-For", () => {
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });
  it('True-Client-IP when CF-Connecting-IP is missing', () => {
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6', 'true-client-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });
  it('X-Forwarded-For only as a fallback; nothing at all → "local"', () => {
    expect(clientIp(h({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }))).toBe('198.51.100.7');
    expect(clientIp(h({}))).toBe('local');
  });
});
