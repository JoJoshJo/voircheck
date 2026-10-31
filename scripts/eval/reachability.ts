/**
 * Cheap reachability check before a KERNEL scan: plain HTTP requests from the runner (no browser, no JavaScript,
 * nothing rendered or saved), same SSRF guards as the scanner on every redirect hop. A site is dead ONLY when its
 * name doesn't resolve, the connection is refused or times out, it's a parked/for-sale page, or it redirects to an
 * unrelated domain. Everything else (certificate problems, HTTP errors, bot walls) is scanned and judged.
 */
import { assertSafeUrlShape, domainInfo, resolvePublicHost, SsrfError, type Resolver } from '@voircheck/scanner';

export type Reachability = { alive: true; finalUrl: string; note?: string } | { alive: false; reason: string };

/** Network failures that mean nobody is there. Anything else (TLS/certificate errors included) is the scanner's job. */
export const DEAD_ERRORS = new Set([
  'ENOTFOUND', // DNS: no such name
  'EAI_AGAIN',
  'EAI_NONAME',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'TimeoutError', // our own request timeout
  'UND_ERR_CONNECT_TIMEOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

export const PARKED_RE =
  /(this domain (name )?(is|may be) for sale|domain (is )?for sale|buy this domain|kaufen sie diese domain|domain kaufen|ce domaine est à vendre|parkingcrew|sedoparking|sedo\.com\/search|bodis\.com|dan\.com\/buy-domain|afternic|hugedomains|domain parking|geparkte domain|this domain has expired|domain has been suspended|account suspended)/i;

/** Same site: same registrable domain, or the same brand label on another TLD (brand.com → brand.de). */
export function relatedDomains(a: string, b: string): boolean {
  const x = domainInfo(a);
  const y = domainInfo(b);
  if (x.site && x.site === y.site) return true;
  if (x.registrable && x.registrable === y.registrable) return true;
  return !!x.siteLabel && x.siteLabel === y.siteLabel;
}

/** Pure decision from what the HTTP check saw. */
export function classify(input: { startUrl: string; finalUrl?: string; status?: number; body?: string; error?: string }): Reachability {
  const finalUrl = input.finalUrl ?? input.startUrl;
  if (input.error) {
    if (DEAD_ERRORS.has(input.error)) return { alive: false, reason: `unreachable: ${input.error}` };
    // e.g. CERT_HAS_EXPIRED: the site is there; an invalid certificate is a finding for the scanner, not a dead site.
    return { alive: true, finalUrl, note: `HTTP check failed (${input.error}); scanning anyway` };
  }
  if (!relatedDomains(input.startUrl, finalUrl)) return { alive: false, reason: `redirects to unrelated domain ${new URL(finalUrl).hostname}` };
  if (input.body && PARKED_RE.test(input.body)) return { alive: false, reason: 'parked / for-sale page' };
  // HTTP errors (403 bot walls, 404, 5xx) are scanned too: the scanner turns pages it can't read into "couldn't verify".
  return input.status && input.status >= 400 ? { alive: true, finalUrl, note: `HTTP ${input.status}` } : { alive: true, finalUrl };
}

const MAX_HOPS = 6;
const MAX_BODY = 200_000;
const UA = 'Mozilla/5.0 (compatible; VoirCheckEval/1.0; reachability check)';

export async function checkReachability(startUrl: string, deps: { fetch?: typeof fetch; resolve?: Resolver; timeoutMs?: number } = {}): Promise<Reachability> {
  const fetchImpl = deps.fetch ?? fetch;
  let url = startUrl;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const u = assertSafeUrlShape(url);
      await resolvePublicHost(u.hostname, deps.resolve);
      const res = await fetchImpl(u.href, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
      });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        url = new URL(loc, u).href;
        continue;
      }
      const body = (await res.text()).slice(0, MAX_BODY);
      return classify({ startUrl, finalUrl: url, status: res.status, body });
    }
    return classify({ startUrl, error: 'too many redirects' });
  } catch (err) {
    // A hop to a private/internal address is never followed (and the scanner would refuse the store too).
    if (err instanceof SsrfError) return { alive: false, reason: `redirect blocked by the SSRF guard (${err.message})` };
    const e = err as Error & { code?: string; cause?: { code?: string } };
    return classify({ startUrl, finalUrl: url, error: e.cause?.code ?? e.code ?? (e.name === 'TimeoutError' ? 'TimeoutError' : e.message) });
  }
}
