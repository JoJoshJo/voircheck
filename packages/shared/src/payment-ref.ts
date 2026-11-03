/**
 * VoirCheck's own short order reference (e.g. VC-7K2F), one per payment: public-safe (not a PayPal ID, not a secret;
 * every lookup by it is scoped to the owner). Postgres makes them (vc_payment_ref(), db migration 0004) from this
 * alphabet, which leaves out 0/O and 1/I so a reference is easy to read out.
 */
export const PAYMENT_REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PAYMENT_REF_RE = /^VC-[2-9A-HJ-NP-Z]{4}$/;

/** "vc-7k2f", " VC-7K2F " → "VC-7K2F"; anything else → null. */
export function parsePaymentRef(s: string): string | null {
  const ref = s.trim().toUpperCase();
  return PAYMENT_REF_RE.test(ref) ? ref : null;
}

/** For the in-memory test store (Postgres makes the real ones). */
export function randomPaymentRef(random: () => number = Math.random): string {
  let out = 'VC-';
  for (let i = 0; i < 4; i++) out += PAYMENT_REF_ALPHABET[Math.floor(random() * PAYMENT_REF_ALPHABET.length)];
  return out;
}
