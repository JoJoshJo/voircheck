import type { CantVerify } from '@voircheck/scanner';
import { fmt, type Dict } from './i18n';

/** Why VoirCheck couldn't verify the store, in the person's language ("blocked by a bot check (HTTP 403)"). */
export function cantVerifyReason(t: Dict, cv: CantVerify): string {
  const reason = t.workspace[`cv_${cv.reason}`];
  return cv.httpStatus ? `${reason} (HTTP ${cv.httpStatus})` : reason;
}

/**
 * The line under a verdict: "Risk score: 45/100", or "Couldn't verify — blocked by a bot check" when the store is on
 * HOLD only because it couldn't be verified (then the score, often 0, says nothing).
 */
export function scoreLine(t: Dict, s: { score: number; cantVerify?: CantVerify | null }): string {
  if (s.cantVerify) return fmt(t.workspace.couldntVerify, { reason: cantVerifyReason(t, s.cantVerify) });
  return `${t.workspace.score}: ${s.score}/100`;
}
