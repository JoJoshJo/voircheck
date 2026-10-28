import type { Dict } from '../lib/i18n';

export type Verdict = 'SAFE' | 'HOLD' | 'BLOCK';

/** Verdicts are the only color in the UI (spec 5.12). */
export const VERDICT_CLASSES: Record<Verdict, string> = {
  SAFE: 'bg-safe-bg text-safe',
  HOLD: 'bg-hold-bg text-hold',
  BLOCK: 'bg-block-bg text-block',
};

export function VerdictBadge({ verdict, t, large = false }: { verdict: Verdict; t: Dict; large?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${VERDICT_CLASSES[verdict]} ${large ? 'px-4 py-1.5 text-[15px]' : 'px-2.5 py-0.5 text-[13px]'}`}>
      {t.verdict[verdict]}
    </span>
  );
}
