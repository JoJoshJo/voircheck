import { isGuestEmail } from './guest';
import type { Lang } from './i18n';
import { buildReceiptEmail, isFinalAction } from './receipt-email';
import type { ReceiptSnapshot } from './receipt-snapshot';

/**
 * Sends the Trust Receipt email. Never throws and never runs before the money decision is committed (callers invoke
 * it after the payment row and receipt are saved). One email per receipt: `claim` atomically marks the receipt as
 * emailed (trust_receipts.emailed_at) so a webhook retry or a second tab can't send again, and Resend's idempotency
 * key covers retries of the same request. A failed send releases the claim, so a later trigger can retry.
 */
export const DEFAULT_EMAIL_FROM = 'VoirCheck <receipts@mail.voircheck.com>';

export interface ResendLike {
  emails: {
    send(
      payload: { from: string; to: string[]; subject: string; html: string; text: string },
      options?: { idempotencyKey?: string },
    ): Promise<{ data: { id: string } | null; error: { message: string; name?: string } | null }>;
  };
}

export type MailResult = 'sent' | 'failed' | 'skipped_no_key' | 'skipped_guest' | 'skipped_no_address' | 'not_final' | 'duplicate';

export interface MailerDeps {
  resend: ResendLike | null;
  from: string;
  /** Atomically mark the receipt as emailed; false if it already was. */
  claim(): Promise<boolean>;
  /** Undo `claim` after a failed send. */
  release(): Promise<void>;
  /** Append to the audit trail. Never given the address. */
  audit(action: 'receipt.email_sent' | 'receipt.email_failed' | 'receipt.email_skipped', details: Record<string, unknown>): Promise<void>;
  log?: (msg: string) => void;
}

let warnedNoKey = false;
/** Test hook: reset the once-only "no API key" log. */
export const resetNoKeyWarning = () => {
  warnedNoKey = false;
};

export async function deliverReceiptEmail(
  input: { receiptId: string; slug: string; to: string | null; lang: Lang; snapshot: ReceiptSnapshot; baseUrl: string },
  deps: MailerDeps,
): Promise<MailResult> {
  const log = deps.log ?? ((m: string) => console.info(m));
  try {
    if (!isFinalAction(input.snapshot.action)) return 'not_final';
    if (!deps.resend) {
      if (!warnedNoKey) log('RESEND_API_KEY is not set: Trust Receipt emails are skipped.');
      warnedNoKey = true;
      return 'skipped_no_key';
    }
    // Demo/guest accounts use a reserved .invalid domain that can never receive mail.
    if (!input.to) {
      await deps.audit('receipt.email_skipped', { reason: 'no address' });
      return 'skipped_no_address';
    }
    if (isGuestEmail(input.to)) {
      await deps.audit('receipt.email_skipped', { reason: 'demo account (no real inbox)' });
      return 'skipped_guest';
    }
    if (!(await deps.claim())) return 'duplicate';

    const email = buildReceiptEmail({ snapshot: input.snapshot, slug: input.slug, lang: input.lang, baseUrl: input.baseUrl });
    try {
      const { data, error } = await deps.resend.emails.send(
        { from: deps.from, to: [input.to], subject: email.subject, html: email.html, text: email.text },
        { idempotencyKey: `trust-receipt/${input.receiptId}` },
      );
      if (error || !data?.id) throw new Error(error?.message ?? 'no message id');
      await deps.audit('receipt.email_sent', { resendId: data.id, lang: input.lang, action: input.snapshot.action });
      return 'sent';
    } catch (err) {
      await deps.release().catch(() => {});
      await deps.audit('receipt.email_failed', { error: err instanceof Error ? err.message.slice(0, 200) : 'send failed', lang: input.lang });
      log(`Trust Receipt email failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return 'failed';
    }
  } catch (err) {
    // Even the audit or claim failing must not reach the payment flow.
    log(`Trust Receipt email error: ${err instanceof Error ? err.message : 'unknown error'}`);
    return 'failed';
  }
}
