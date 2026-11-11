import { type NextRequest } from 'next/server';
import { clientIp } from '../../../lib/client-ip';
import { hitWindow } from '../../../lib/rate-limit';
import { normalizeDomain, SAVED_VERDICT_READS_PER_IP_PER_HOUR, savedVerdictFor } from '../../../lib/saved-verdict';

export const dynamic = 'force-dynamic';

/**
 * GET /api/verdict?domain=shop.example: the Chrome extension's saved-result lookup (spec 5.23). Read only: no scan,
 * no AI call, no sign-in, no cookies read. Only the domain comes in; only verdict, hedged line and date go out.
 */
export async function GET(request: NextRequest) {
  const headers = { 'cache-control': 'no-store' };
  if (!hitWindow(`saved-verdict:${clientIp(request.headers)}`, SAVED_VERDICT_READS_PER_IP_PER_HOUR)) {
    return Response.json({ error: 'rate_limited' }, { status: 429, headers });
  }
  const domain = normalizeDomain(request.nextUrl.searchParams.get('domain'));
  if (!domain) return Response.json({ error: 'invalid_domain' }, { status: 400, headers });
  try {
    return Response.json(await savedVerdictFor(domain), { headers });
  } catch (err) {
    console.error('saved verdict lookup failed', err);
    return Response.json({ error: 'unavailable' }, { status: 503, headers });
  }
}
