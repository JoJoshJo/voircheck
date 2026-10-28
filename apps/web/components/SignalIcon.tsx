export type SignalState = 'pass' | 'warn' | 'fail' | 'unavailable' | 'pending';

export const SIGNAL_ORDER = ['domain_age', 'ssl_redirects', 'price', 'ai_page', 'threat_list', 'clone'] as const;

/**
 * ✓ / ⚠ / ✗ marks for the live checklist. Pass/warn/fail use the verdict colors (the only color in the UI);
 * "not checked" and "checking" stay gray.
 */
export function SignalIcon({ state }: { state: SignalState }) {
  const base = 'vc-tick inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-medium';
  if (state === 'pending') return <span className="inline-block h-6 w-6 animate-pulse rounded-full border border-line bg-surface motion-reduce:animate-none" aria-hidden />;
  if (state === 'pass') return <span key={state} className={`${base} bg-safe-bg text-safe`} aria-hidden>✓</span>;
  if (state === 'warn') return <span key={state} className={`${base} bg-hold-bg text-hold`} aria-hidden>{'\u26A0\uFE0E'}</span>;
  if (state === 'fail') return <span key={state} className={`${base} bg-block-bg text-block`} aria-hidden>✗</span>;
  return <span key={state} className={`${base} bg-surface text-faint`} aria-hidden>–</span>;
}
