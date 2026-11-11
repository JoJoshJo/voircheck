/**
 * What the popup hands to VoirCheck (spec 5.23): the current tab's link, if it's a store page we can check, as
 * https://voircheck.com/check?url=…. The /check route validates it again and only fills the check box; the person
 * presses Check in the app. Nothing here reads the page or touches payment data; the only call is savedVerdictUrl below.
 */
export const APP_ORIGIN = 'https://voircheck.com';

const MAX_LENGTH = 2048;
// VoirCheck itself isn't a store to check.
const OWN_HOSTS = ['voircheck.com', 'voircheck-web.onrender.com'];

/**
 * The tab's link if it's an http(s) page with no credentials, at most 2048 characters (the same rules as the web
 * app's pendingCheckUrl), not VoirCheck's own site. The #fragment is dropped: it never helps a scan. Else null.
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function checkableUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (OWN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  u.hash = '';
  return u.href.length <= MAX_LENGTH ? u.href : null;
}

/**
 * The VoirCheck link that opens the workspace with this store in the check box, or null.
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function checkLink(raw) {
  const url = checkableUrl(raw);
  if (!url) return null;
  const link = new URL('/check', APP_ORIGIN);
  link.searchParams.set('url', url);
  return link.href;
}

/**
 * The host to show in the popup ("velbrook.example"), without "www.".
 * @param {string} url
 * @returns {string}
 */
export function hostOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

/**
 * Where the popup asks for a saved result (spec 5.23, Nov 11): voircheck.com/api/verdict with the DOMAIN only, never
 * the path, query or anything from the page.
 * @param {string} domain
 * @returns {string}
 */
export function savedVerdictUrl(domain) {
  const link = new URL('/api/verdict', APP_ORIGIN);
  link.searchParams.set('domain', domain);
  return link.href;
}
