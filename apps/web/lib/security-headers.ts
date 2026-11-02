/**
 * Security headers for every page and API response (next.config.ts). What the page legitimately loads:
 * - PayPal JS SDK v6 (script, its API calls, its button iframes and images); the approval popup is its own window.
 * - KERNEL live view: an iframe of the cloud browser while a scan runs.
 * - Inter is self-hosted by next/font, so no font host. Auth runs same-origin through /api/auth; Google sign-in is a
 *   top-level navigation, which CSP doesn't restrict.
 * Next.js inlines its bootstrap scripts, so script-src keeps 'unsafe-inline' (no nonce pipeline); React escapes all
 * rendered text. frame-ancestors 'none' stops clickjacking of the Pay / Capture / "Pay anyway" buttons.
 */
const PAYPAL = ['https://*.paypal.com', 'https://*.paypalobjects.com'];
// Live-view hosts look like prod-iad-hypeman-23.kernel.sh:8443 (seen live, Nov 2).
const KERNEL = ['https://*.kernel.sh:*'];

export function contentSecurityPolicy(dev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...PAYPAL],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...PAYPAL],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...PAYPAL, ...(dev ? ['ws:'] : [])],
    'frame-src': [...PAYPAL, ...KERNEL],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!dev) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

export function securityHeaders(dev: boolean): Array<{ key: string; value: string }> {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(dev) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://www.paypal.com" "https://www.sandbox.paypal.com")' },
    // Browsers ignore HSTS over plain http, so localhost is unaffected; Render serves https only.
    ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
  ];
}
