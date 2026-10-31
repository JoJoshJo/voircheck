/**
 * Cheap reachability check before a KERNEL scan: plain HTTP requests from the runner (no browser, no JavaScript,
 * nothing rendered or saved), same SSRF guards as the scanner on every redirect hop. Classifies a site as dead when
 * it doesn't resolve/answer, returns 404/410/5xx, is a parked/for-sale page, or redirects to an unrelated domain.
 */
import { assertSafeUrlShape, domainInfo, resolvePublicHost, type Resolver } from '@voircheck/scanner';

export type Reachability = { alive: true; finalUrl: string } | { alive: false; reason: string };

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
  if (input.error) return { alive: false, reason: `unreachable: ${input.error}` };
  const finalUrl = input.finalUrl ?? input.startUrl;
  if (!relatedDomains(input.startUrl, finalUrl)) return { alive: false, reason: `redirects to unrelated domain ${new URL(finalUrl).hostname}` };
  const status = input.status ?? 0;
  if (status === 404 || status === 410) return { alive: false, reason: `HTTP ${status}` };
  if (status >= 500) return { alive: false, reason: `HTTP ${status}` };
  // 401/403/429 are usually bot protection on a live shop: KERNEL (a real browser) gets a fair try.
  if (input.body && PARKED_RE.test(input.body)) return { alive: false, reason: 'parked / for-sale page' };
  return { alive: true, finalUrl };
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
      const body = res.status < 400 ? (await res.text()).slice(0, MAX_BODY) : '';
      if (res.status >= 400) await res.body?.cancel().catch(() => {});
      return classify({ startUrl, finalUrl: url, status: res.status, body });
    }
    return classify({ startUrl, error: 'too many redirects' });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return classify({ startUrl, error: e.cause?.code ?? e.message });
  }
}
