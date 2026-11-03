import type { HardRule, SignalResult, Verdict } from './schema';
import { THRESHOLDS } from './scoring';

/** Why a scan couldn't verify the store, as a short code the UI translates (the scan writes the sentence in scan.ts). */
export type CantVerifyReason = 'bot_check' | 'error_page' | 'empty_page' | 'visit_failed';
export interface CantVerify {
  reason: CantVerifyReason;
  httpStatus?: number;
}

const LINE = "Couldn't verify this store: ";

/**
 * The can't-verify reason of a scan whose verdict is HOLD only because of the can't-verify rule (score alone would be
 * SAFE, no other hard rule). Then "Risk score 0/100" says nothing useful; the reason does. Null otherwise.
 */
export function cantVerifyOnly(scan: { verdict: Verdict; score: number; hardRules: readonly HardRule[] | readonly string[]; signals: readonly SignalResult[] }): CantVerify | null {
  if (scan.verdict !== 'HOLD' || scan.score >= THRESHOLDS.hold) return null;
  if (!scan.hardRules.includes('cant_verify') || scan.hardRules.some((r) => r !== 'cant_verify')) return null;
  const line = scan.signals.find((s) => s.id === 'ssl_redirects')?.evidence.find((e) => e.startsWith(LINE))?.slice(LINE.length) ?? '';
  const status = /\(HTTP (\d{3})\)/.exec(line)?.[1];
  const reason: CantVerifyReason = line.startsWith('blocked by a bot check')
    ? 'bot_check'
    : line.startsWith('the store returned an error page')
      ? 'error_page'
      : line.startsWith('the page showed no content')
        ? 'empty_page'
        : 'visit_failed';
  return { reason, ...(status && reason !== 'visit_failed' ? { httpStatus: Number(status) } : {}) };
}
