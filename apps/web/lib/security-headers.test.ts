import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

const header = (dev: boolean, key: string) => securityHeaders(dev).find((h) => h.key === key)?.value;
const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));

describe('security headers', () => {
  it('production: CSP, HSTS, nosniff, no framing, referrer policy', () => {
    expect(header(false, 'Strict-Transport-Security')).toMatch(/max-age=31536000/);
    expect(header(false, 'X-Content-Type-Options')).toBe('nosniff');
    expect(header(false, 'X-Frame-Options')).toBe('DENY');
    expect(header(false, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header(false, 'Content-Security-Policy')).toContain('upgrade-insecure-requests');
  });
  it('nobody can frame the money buttons; no plugins; forms and <base> stay on our origin', () => {
    const csp = contentSecurityPolicy(false);
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'form-action')).toBe("form-action 'self'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
  });
  it('allows only what the page loads: PayPal SDK and KERNEL live view', () => {
    const csp = contentSecurityPolicy(false);
    expect(directive(csp, 'script-src')).toContain('https://*.paypal.com');
    expect(directive(csp, 'frame-src')).toBe('frame-src https://*.paypal.com https://*.paypalobjects.com https://*.kernel.sh:*');
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-eval'");
  });
  it('dev adds only what Next.js dev needs (eval for fast refresh, websocket HMR) and no HSTS', () => {
    expect(directive(contentSecurityPolicy(true), 'script-src')).toContain("'unsafe-eval'");
    expect(directive(contentSecurityPolicy(true), 'connect-src')).toContain('ws:');
    expect(header(true, 'Strict-Transport-Security')).toBeUndefined();
  });
});
