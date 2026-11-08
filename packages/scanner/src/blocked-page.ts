import { domainInfo } from './domain';
import type { PageSnapshot } from './kernel';

/**
 * Bot checks and other pages that aren't the store (spec 5.18 "can't verify = never SAFE"). When the cloud browser
 * only sees a challenge, an error page or an empty shell, the page-based signals have nothing real to judge, so the
 * scan counts as "couldn't verify" (at least HOLD) instead of scoring the challenge page as if it were the shop.
 */

/** Challenge texts: Cloudflare, DDoS-Guard, Imperva/Incapsula, PerimeterX, Sucuri, generic captcha walls (EN/DE/FR). */
export const CHALLENGE_RE = new RegExp(
  [
    'checking (if the site connection is secure|your browser)',
    'just a moment\\.\\.\\.',
    'verify(ing)? (that )?you are (a )?human',
    'are you a robot',
    'attention required!? \\| cloudflare',
    'performance (&|and) security by cloudflare',
    'enable javascript and cookies to continue',
    'ddos[- ]guard',
    'ddos protection by',
    'pardon our interruption',
    'request unsuccessful\\. incapsula',
    'press (&|and) hold',
    'sucuri website firewall',
    'please complete the security check',
    'überprüfung (ihres|des) browsers',
    'wir überprüfen ihren browser',
    'bestätigen sie, dass sie ein mensch sind',
    'vérification (de votre navigateur|en cours)',
    'vérifiez que vous êtes (un )?humain',
    'confirmez que vous êtes (un )?humain',
  ].join('|'),
  'i',
);

/** A challenge page is short; a real shop that mentions "captcha" in its footer is not a wall. */
export const MAX_CHALLENGE_TEXT = 1_000;
const MIN_REAL_TEXT = 40;

export type BlockedReason = { kind: 'bot_check' | 'error_page' | 'empty_page' | 'sent_away'; message: string; detail?: string };

/**
 * Sites a shop never sends a shopper to instead of its own page: search engines and big portals. A store link that
 * ends there (while the store isn't that site) hides its page from our check, which real shops don't do. Matched on
 * the registrable domain's name, so every country version counts (google.de, consent.google.com, yahoo.co.jp).
 */
export const DECOY_SITES = ['google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'baidu', 'ecosia', 'qwant', 'startpage', 'msn', 'aol', 'ask', 'youtube', 'wikipedia'] as const;

const siteName = (u: string) => {
  try {
    return domainInfo(u).registrable ?? new URL(u).hostname;
  } catch {
    return null;
  }
};
const label = (site: string) => site.split('.')[0]!;

/**
 * Where a real shop may send a shopper's browser on its own: its shop platform, checkout and payment providers, CDNs
 * and site builders (spec 5.5, Nov 8). Matched on the registrable domain's name, like DECOY_SITES.
 */
export const PLATFORM_SITES = [
  'shopify', 'myshopify', 'shop', 'shopifypreview', 'bigcommerce', 'mybigcommerce', 'wix', 'wixsite', 'squarespace', 'webflow', 'jimdo', 'jimdosite', 'ecwid', 'bigcartel', 'godaddysites', 'weebly', 'strikingly', 'shopware', 'plentymarkets', 'jtl', 'woocommerce', 'wordpress',
  'paypal', 'stripe', 'klarna', 'adyen', 'mollie', 'sumup', 'checkout', 'squareup', 'square', 'braintreegateway', 'worldpay', 'payone', 'unzer', 'computop', 'paydirekt', 'giropay', 'sofort', 'trustly', 'ratepay', 'afterpay', 'clearpay', 'affirm', 'paddle', 'lemonsqueezy', 'gumroad',
  'cloudflare', 'cloudflareaccess', 'akamai', 'akamaized', 'akamaihd', 'edgekey', 'edgesuite', 'fastly', 'cloudfront', 'azureedge', 'azurefd', 'bunny', 'b-cdn', 'cdn77', 'netlify', 'vercel', 'herokuapp', 'onrender',
] as const;

/**
 * Links that only forward to a shop: short links, ad clicks and affiliate networks. A pasted link like this ends on the
 * real shop, and the shop is what gets judged, so it isn't "sent away". By registrable name, or a click/go/track host.
 */
export const REDIRECTOR_SITES = ['bit', 'amzn', 'tinyurl', 'ow', 'buff', 'lnkd', 'rebrand', 'cutt', 'shorturl', 'awin1', 'linksynergy', 'shareasale', 'sjv', 'anrdoezrs', 'dpbolvw', 'jdoqocy', 'kqzyfj', 'tkqlhce', 'pjtra', 'avantlink', 'rstyle', 'skimresources', 'redirectingat', 'googleadservices', 'doubleclick', 'tradedoubler', 'webgains', 'partnerize', 'prf', 'impactradius', 'ojrq', 'evyy', 'idealo', 'geizhals', 'pricerunner'] as const;
const REDIRECTOR_HOST = /^(click|clicks|go|track|tracking|trk|redirect|r|links?|out|aff|affiliate)\./i;

function isRedirector(url: string, site: string): boolean {
  if ((REDIRECTOR_SITES as readonly string[]).includes(label(site))) return true;
  if (site === 't.co') return true;
  try {
    return REDIRECTOR_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

const bare = (l: string) => l.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The same shop name: equal, or one contains the other (werksraeder-24 / werksraeder, galeria-kaufhof / galeria). */
export function sameShopName(a: string, b: string): boolean {
  const x = bare(a);
  const y = bare(b);
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}

/**
 * The store sent the cloud browser somewhere that isn't the store: a search engine or portal (Nov 7), or since Nov 8
 * any unrelated site that isn't the shop's own name (another country version, a longer or shorter form of it) or a
 * shop platform, checkout, payment or CDN provider (PLATFORM_SITES).
 */
export function detectSentAway(requestedUrl: string, finalUrl: string): BlockedReason | null {
  const from = siteName(requestedUrl);
  const to = siteName(finalUrl);
  if (!from || !to || from === to || sameShopName(label(from), label(to))) return null;
  if (isRedirector(requestedUrl, from)) return null;
  if (!(DECOY_SITES as readonly string[]).includes(label(to)) && (PLATFORM_SITES as readonly string[]).includes(label(to))) return null;
  const what = new URL(requestedUrl).pathname.replace(/\/+$/, '') ? 'its product page' : 'its shop';
  return {
    kind: 'sent_away',
    message: `it sent our check to ${to} instead of showing ${what}`,
    detail: `This shop sent our check to ${to} instead of showing ${what}. Real shops don't hide their pages.`,
  };
}

export function detectBlockedPage(page: Pick<PageSnapshot, 'title' | 'h1' | 'visibleText' | 'httpStatus'>): BlockedReason | null {
  const text = page.visibleText.replace(/\s+/g, ' ').trim();
  const head = `${page.title} ${page.h1 ?? ''} ${text}`;
  if (text.length <= MAX_CHALLENGE_TEXT && CHALLENGE_RE.test(head)) {
    return { kind: 'bot_check', message: 'blocked by a bot check' };
  }
  if (page.httpStatus !== null && page.httpStatus >= 400 && text.length <= MAX_CHALLENGE_TEXT) {
    if (page.httpStatus === 403 || page.httpStatus === 429) return { kind: 'bot_check', message: `blocked by a bot check (HTTP ${page.httpStatus})` };
    return { kind: 'error_page', message: `the store returned an error page (HTTP ${page.httpStatus})` };
  }
  if (text.length < MIN_REAL_TEXT) return { kind: 'empty_page', message: 'the page showed no content (empty shell)' };
  return null;
}
