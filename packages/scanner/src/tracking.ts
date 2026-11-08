/**
 * Ad and click-tracking parameters (spec 5.5): stripped before a link is scanned, stored or used as a cache key.
 * They identify one person's click (gclid, fbclid, ...) or a campaign (utm_*); they never change which product a page
 * shows. Everything else (variant, currency, country, page, ...) is kept.
 */
const EXACT = new Set(['gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'twclid', 'yclid', 'igshid', 'mc_cid', 'mc_eid', 'stkn', 'srsltid', '_gl']);
const PREFIXES = ['utm_', 'gad_'];

export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return EXACT.has(n) || PREFIXES.some((p) => n.startsWith(p));
}

/** The URL without tracking parameters (and without a fragment). Unparseable input is returned unchanged. */
export function stripTracking(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw;
  }
  for (const k of [...u.searchParams.keys()]) if (isTrackingParam(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.href;
}
