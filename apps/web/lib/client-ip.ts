/**
 * The visitor's IP for per-IP rate limits. Render's proxy appends to X-Forwarded-For without removing what the visitor
 * sent, so its first entry can be forged. Render's edge is Cloudflare, which overwrites CF-Connecting-IP and
 * True-Client-IP with the real address, so those come first. X-Forwarded-For is only the fallback (local dev, or if the
 * edge ever stops sending them; the first use logs which source is in effect so that shows up in Render's logs).
 */
type HeaderReader = { get(name: string): string | null };

const SOURCES = ['cf-connecting-ip', 'true-client-ip'] as const;
let logged = false;

export function clientIp(h: HeaderReader): string {
  for (const name of SOURCES) {
    const v = h.get(name)?.trim();
    if (v) return note(name, v);
  }
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded ? note('x-forwarded-for (spoofable)', forwarded) : 'local';
}

function note(source: string, ip: string): string {
  if (!logged && process.env.NODE_ENV === 'production') {
    logged = true;
    console.info(`[rate-limit] client IP source: ${source}`);
  }
  return ip;
}
