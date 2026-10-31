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

export type BlockedReason = { kind: 'bot_check' | 'error_page' | 'empty_page'; message: string };

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
