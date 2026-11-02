import { headers } from 'next/headers';
import { allowAuthEmail, emailFrom, sendsEmail, tooManyEmails } from '../../../../lib/auth/email-limit';
import { authHandlers, type AuthRouteHandler } from '../../../../lib/auth/handlers';
import { pendingCookie } from '../../../../lib/auth/magic-link-exchange';
import { clientIp } from '../../../../lib/client-ip';

// Resolved per request (not at import), so the build never needs the auth env vars.
export const GET: AuthRouteHandler = (req, ctx) => authHandlers().GET(req, ctx);

export const POST: AuthRouteHandler = async (req, ctx) => {
  const path = (await ctx.params).path.join('/');
  // Endpoints that send an email are rate-limited here, before Neon Auth sends anything.
  if (sendsEmail(path) && !allowAuthEmail(clientIp(await headers()), await emailFrom(req))) return tooManyEmails();
  const res = await authHandlers().POST(req, ctx);
  // This browser asked for a magic link: remember that, so the link's session can be handed over here (and only here).
  if (path === 'sign-in/magic-link' && res.ok) {
    const out = new Response(res.body, res);
    out.headers.append('set-cookie', pendingCookie(new URL(req.url).protocol === 'https:'));
    return out;
  }
  return res;
};
