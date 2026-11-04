import { headers } from 'next/headers';

/**
 * CSRF guard for every cookie-authenticated, state-changing request (security review, L1): pay actions (approve,
 * capture, void, refund, autopay…), scans, the shopping agent and all server actions (settings, agent tokens,
 * onboarding, demo, sign-in, sign-out). The request's Origin (or, without one, its Referer's origin) must be our own
 * site. Browsers always send Origin on POST, so a missing one is refused too.
 * Not used by POST /api/mcp (Bearer token, never a cookie) or the PayPal webhook (signature verified with PayPal).
 */
type HeaderReader = { get(name: string): string | null };

export const OWN_ORIGINS = ['https://voircheck.com', 'https://voircheck-web.onrender.com'] as const;

function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const o = new URL(url).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

export function isOwnOrigin(origin: string, env: Record<string, string | undefined> = process.env): boolean {
  const allowed = new Set<string>(OWN_ORIGINS);
  for (const configured of [env.APP_URL, env.VOIRCHECK_APP_URL]) {
    const o = originOf(configured?.trim());
    if (o) allowed.add(o);
  }
  if (allowed.has(origin)) return true;
  if (env.NODE_ENV === 'production') return false;
  // Local dev only: http://localhost or 127.0.0.1 on any port.
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function isSameOriginRequest(h: HeaderReader, env: Record<string, string | undefined> = process.env): boolean {
  const origin = originOf(h.get('origin')) ?? originOf(h.get('referer'));
  return !!origin && isOwnOrigin(origin, env);
}

/** For route handlers: the 403 to return, or null when the request is from our own site. */
export function crossOriginRefusal(req: Request): Response | null {
  if (isSameOriginRequest(req.headers)) return null;
  return Response.json({ error: 'origin' }, { status: 403, headers: { 'cache-control': 'no-store' } });
}

export class CrossOriginError extends Error {
  constructor() {
    super('cross-origin request refused');
    this.name = 'CrossOriginError';
  }
}

/** For server actions (first line of each): throws unless the request is from our own site. */
export async function requireSameOrigin(): Promise<void> {
  if (!isSameOriginRequest(await headers())) throw new CrossOriginError();
}
