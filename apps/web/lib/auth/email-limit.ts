import { hitWindow } from '../rate-limit';

/**
 * Auth endpoints that send an email (magic link, password reset, verification). Without a limit of our own, anyone
 * could make VoirCheck mail any address over and over. Per IP and per recipient, sliding hour, in memory (one
 * instance, like the other per-IP limits). Neon Auth may limit too; this doesn't rely on it.
 */
export const EMAIL_LIMITS = { perIpPerHour: 5, perAddressPerHour: 3 } as const;

const SENDS_EMAIL = new Set(['sign-in/magic-link', 'forget-password', 'request-password-reset', 'send-verification-email', 'email-otp/send-verification-otp']);

export const sendsEmail = (path: string) => SENDS_EMAIL.has(path);

export function allowAuthEmail(ip: string, email: string | null): boolean {
  if (!hitWindow(`auth-email-ip:${ip}`, EMAIL_LIMITS.perIpPerHour)) return false;
  return !email || hitWindow(`auth-email-to:${email.trim().toLowerCase()}`, EMAIL_LIMITS.perAddressPerHour);
}

/** The recipient from the request body, without consuming the original request. */
export async function emailFrom(req: Request): Promise<string | null> {
  const body = (await req.clone().json().catch(() => null)) as { email?: unknown } | null;
  return typeof body?.email === 'string' ? body.email.slice(0, 254) : null;
}

export const tooManyEmails = () =>
  Response.json({ code: 'RATE_LIMITED', message: 'Too many emails requested. Try again later.' }, { status: 429, headers: { 'retry-after': '3600' } });
