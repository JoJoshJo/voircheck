import type { ReactNode } from 'react';

export type SignalState = 'pass' | 'warn' | 'fail' | 'unavailable' | 'pending';

export const SIGNAL_ORDER = ['domain_age', 'ssl_redirects', 'price', 'ai_page', 'threat_list', 'clone'] as const;
export type SignalId = (typeof SIGNAL_ORDER)[number];

/** Outline glyph per check (24px grid, 1.6px line). The `vc-m` part is what moves while the check runs. */
const GLYPHS: Record<SignalId, ReactNode> = {
  // Domain age: a clock whose hand turns.
  domain_age: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path className="vc-m" d="M12 7.5V12l3 2" />
    </>
  ),
  // HTTPS: a lock whose shackle bobs.
  ssl_redirects: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path className="vc-m" d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  // Price: a tag that swings on its hole.
  price: (
    <g className="vc-m">
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.6 6.6a1.4 1.4 0 0 1-2 0z" />
      <circle cx="8" cy="8" r="1.3" />
    </g>
  ),
  // Page analysis: a page with a scan line moving down it.
  ai_page: (
    <>
      <path d="M6.5 3.5h7l4 4v13h-11z" />
      <path d="M13.5 3.5v4h4" />
      <path className="vc-m" d="M8.5 11h6" />
    </>
  ),
  // Threat lists: a shield whose list redraws.
  threat_list: (
    <>
      <path d="M12 3.5l7 2.7v5.3c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6.2z" />
      <path className="vc-m" d="M9 10.5h6M9 14h4" pathLength={1} />
    </>
  ),
  // Copycat sites: two copies, one sliding over the other.
  clone: (
    <>
      <rect x="4" y="4" width="11" height="11" rx="2" />
      <rect className="vc-m" x="9" y="9" width="11" height="11" rx="2" />
    </>
  ),
};

/** Result marks: ✓ looks fine, amber – a bit off, ✕ warning sign, grey – not checked. */
export const MARKS: Record<Exclude<SignalState, 'pending'>, { d: string; disc: string; ink: string }> = {
  pass: { d: 'M8 12.3l2.7 2.7L16 9.5', disc: 'fill-safe-bg', ink: 'stroke-safe' },
  warn: { d: 'M8.5 12h7', disc: 'fill-hold-bg', ink: 'stroke-hold' },
  fail: { d: 'M9 9l6 6M15 9l-6 6', disc: 'fill-block-bg', ink: 'stroke-block' },
  unavailable: { d: 'M8.5 12h7', disc: 'fill-surface', ink: 'stroke-faint' },
};

/**
 * One check's mark. While a check runs (`pending` with an `id`) its outline icon moves in grey (one 600 ms loop);
 * when it finishes, the icon becomes ✓ / – / ✕ in the verdict colours (the only colour in the UI), or a grey –
 * when it couldn't run. Still under prefers-reduced-motion (globals.css).
 */
export function SignalIcon({ state, id }: { state: SignalState; id?: SignalId | string }) {
  if (state === 'pending') {
    const glyph = id && id in GLYPHS ? GLYPHS[id as SignalId] : null;
    if (!glyph) return <span className="inline-block h-6 w-6 animate-pulse rounded-full border border-line bg-surface motion-reduce:animate-none" aria-hidden />;
    return (
      <svg viewBox="0 0 24 24" className={`vc-sig vc-run vc-run-${id} h-6 w-6 shrink-0 text-faint`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden data-state="pending">
        {glyph}
      </svg>
    );
  }
  const m = MARKS[state];
  return (
    <svg key={state} viewBox="0 0 24 24" className="vc-sig vc-done h-6 w-6 shrink-0" aria-hidden data-state={state}>
      <circle className={`vc-disc ${m.disc}`} cx="12" cy="12" r="12" />
      <path className={`vc-mark ${m.ink}`} d={m.d} pathLength={1} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
