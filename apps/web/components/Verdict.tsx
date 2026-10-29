import type { Dict } from '../lib/i18n';

export type Verdict = 'SAFE' | 'HOLD' | 'BLOCK';

/** Verdicts are the only color in the UI (spec 5.12). */
export const VERDICT_CLASSES: Record<Verdict, string> = {
  SAFE: 'bg-safe-bg text-safe',
  HOLD: 'bg-hold-bg text-hold',
  BLOCK: 'bg-block-bg text-block',
};

/** Pill for lists (history, receipts). */
export function VerdictBadge({ verdict, t }: { verdict: Verdict; t: Dict }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium ${VERDICT_CLASSES[verdict]}`}>{t.verdict[verdict]}</span>;
}

/** Label inside a verdict-colored band: plain text, aligned with the heading (no pill padding). */
export function VerdictLabel({ verdict, t }: { verdict: Verdict; t: Dict }) {
  return <p className="text-[13px] font-medium uppercase tracking-[0.08em]">{t.verdict[verdict]}</p>;
}
