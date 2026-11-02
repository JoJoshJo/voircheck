/**
 * The public app URL for links we hand out (PayPal return/cancel URLs, receipt links in emails). Production uses
 * APP_URL only: building links from request headers (Host, X-Forwarded-Host) would let a forged header point a
 * buyer's PayPal return or receipt email at another site. Local dev falls back to the request's own host.
 */
type HeaderReader = { get(name: string): string | null };

export function publicOrigin(h: HeaderReader): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('APP_URL is not set; links are never built from request headers in production.');
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;
}
