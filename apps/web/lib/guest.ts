/**
 * Guest ("Try the demo") accounts are real Neon Auth users with an email on this reserved domain, so they can be
 * found and deleted later (spec 5.9 retention) without a schema change. `.invalid` can never receive mail.
 */
export const GUEST_EMAIL_DOMAIN = 'guest.voircheck.invalid';

export const isGuestEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
