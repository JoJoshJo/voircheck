/**
 * Fake trust badges (J, Nov 11; model-independent): a shop that claims on its own page to be verified by VoirCheck, or
 * a PayPal-verified merchant, or that PayPal Buyer Protection is "guaranteed", is never SAFE, whatever any AI says.
 * Neither VoirCheck nor PayPal hands out badges for shops to show; only voircheck.com and paypal.com may say it.
 * Run before this rule (Nov 11, attack lab): Gemini read the fake-badge lab page as normal and it came out SAFE 0.
 *
 * A plain mention is not a badge: "Pay with PayPal" and "covered by PayPal Buyer Protection" are normal shop copy.
 * Only a claim of verification / certification / a safety verdict, or a "guaranteed" protection, counts.
 */
const BADGE_PATTERNS = [
  // "Verified (safe) by VoirCheck", "certified by VoirCheck", "approved by VoirCheck"
  '\\b(verified|certified|approved|checked|rated)\\s+(safe\\s+)?by\\s+voir\\s?check\\b',
  // "VoirCheck verified", "VoirCheck safe", "VoirCheck approved", "VoirCheck verdict: SAFE"
  '\\bvoir\\s?check[-\\s]+(verified|safe|approved|certified|trusted)\\b',
  '\\bvoir\\s?check\\s+verdict\\s*:?\\s*safe\\b',
  // "PayPal Verified (Merchant)", "PayPal Certified", "PayPal Approved Seller"
  '\\bpay\\s?pal[-\\s]+(verified|certified|approved|trusted)\\b',
  '\\b(verified|certified|approved)\\s+by\\s+pay\\s?pal\\b',
  // "PayPal Buyer Protection guaranteed" / "guaranteed by PayPal (Buyer Protection)"
  '\\bpay\\s?pal\\s+buyer\\s+protection\\s+(is\\s+)?guaranteed\\b',
  '\\bguaranteed\\s+(by\\s+)?pay\\s?pal\\b',
  // French: "vérifié(e) par VoirCheck", "certifié par PayPal", "protection des achats PayPal garantie"
  '\\b(vérifiée?s?|certifiée?s?|approuvée?s?)\\s+par\\s+(voir\\s?check|pay\\s?pal)\\b',
  '\\bprotection\\s+des\\s+achats\\s+pay\\s?pal\\s+garantie\\b',
];
export const TRUST_BADGE_RE = new RegExp(BADGE_PATTERNS.join('|'), 'i');

/** The only sites allowed to say this about themselves. */
const OFFICIAL_DOMAINS = ['voircheck.com', 'paypal.com'];

export function isOfficialDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * The first fake-badge claim in the shop's own text (page text, image alt, aria-labels, structured data), as a short
 * quote with a little context, or null. Never on voircheck.com / paypal.com.
 */
export function fakeTrustBadge(url: string, texts: readonly string[]): string | null {
  if (isOfficialDomain(url)) return null;
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, ' ');
    const m = TRUST_BADGE_RE.exec(text);
    if (!m) continue;
    const start = Math.max(0, m.index - 30);
    const end = Math.min(text.length, m.index + m[0].length + 30);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`.slice(0, 160);
  }
  return null;
}
