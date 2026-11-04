/**
 * VoirCheck mascot (spec 5.12): minimal black line-art ghost holding a magnifying glass.
 *
 * The ghost is drawn as six strokes (left side, right side, hem, eyes, glass, handle) so it can be built:
 * - `assemble`: draws itself once (landing hero), each stroke ≤ 450 ms, then the face.
 * - `built` (0–6): during a store check, one stroke per finished check; the rest shows as a faint dotted
 *   outline. The verdict face appears only once all six are in.
 * - `faceIn`: the face draws in on mount (the result card, right after the check).
 * Faces: smile (SAFE, looks safe), raised brow (HOLD, a bit off), frown (BLOCK, looks fake).
 * Everything is CSS (globals.css); under prefers-reduced-motion the steps still show, without motion.
 */
import type { CSSProperties } from 'react';

export type MascotMood = 'scanning' | 'SAFE' | 'HOLD' | 'BLOCK' | 'idle';

export const GHOST_STROKES = 6;

const PARTS = [
  { id: 'left', d: 'M14 54V29A16.5 16.5 0 0 1 30.5 12.5' },
  { id: 'right', d: 'M30.5 12.5A16.5 16.5 0 0 1 47 29V54' },
  { id: 'hem', d: 'M47 54l-5.5-4-5.5 4-5.5-4-5.5 4-5.5-4L14 54' },
  { id: 'eyes', d: '' },
  { id: 'glass', d: 'M56.2 37a6.2 6.2 0 1 1-12.4 0a6.2 6.2 0 1 1 12.4 0' },
  { id: 'handle', d: 'M54.4 41.4l4.4 4.4M43.5 41.5q3.5-.5 4.6 2.2', w: 1.2 },
] as const;

const BODY = 'M14 54V29a16.5 16.5 0 0 1 33 0v25l-5.5-4-5.5 4-5.5-4-5.5 4-5.5-4z';

export const FACES: Record<MascotMood, string[]> = {
  SAFE: ['M26.5 35q4 3 8 0'], // smile
  HOLD: ['M22.8 23.6l5-1.6', 'M27.5 36.2q1.5-1 3 0t3 0'], // one raised brow, wavy mouth
  BLOCK: ['M22.5 24.6l4.6-1.2M38.8 24.6l-4.6-1.2', 'M26.8 37q4-3 8 0'], // frown, angled brows
  scanning: ['M29.5 35.2q2 1.2 4 0'],
  idle: ['M29.5 35.2q2 1.2 4 0'],
};

/** Line weight in viewBox units: thinner at large sizes so the ghost stays line art. */
export function strokeScale(size: number): number {
  return Math.min(1, Math.pow(64 / size, 0.55));
}

export function Mascot({
  mood = 'idle',
  size = 64,
  title,
  built,
  assemble = false,
  faceIn = false,
  className,
}: {
  mood?: MascotMood;
  size?: number;
  title?: string;
  /** 0–6 strokes earned by finished checks; omit for the whole ghost. */
  built?: number;
  assemble?: boolean;
  faceIn?: boolean;
  className?: string;
}) {
  const building = built !== undefined;
  const n = building ? Math.max(0, Math.min(GHOST_STROKES, built)) : GHOST_STROKES;
  const complete = n === GHOST_STROKES;
  // While a check is building the ghost, no face until every check is in and a verdict is known.
  const showFace = !building || (complete && mood !== 'scanning' && mood !== 'idle');
  const floating = mood === 'scanning' && !building && !assemble;
  const cls = [floating ? 'vc-float' : '', assemble ? 'vc-asm' : '', faceIn ? 'vc-face-in' : '', className ?? ''].filter(Boolean).join(' ');
  // Ink by default (also inside verdict-colored banners); a dark hero can set --vc-ghost-ink / --vc-ghost-fill.
  const style = { '--vc-k': strokeScale(size), color: 'var(--vc-ghost-ink, #0c0c0c)' } as CSSProperties;
  const off = (i: number) => (i >= n ? ' vc-off' : '');
  return (
    // title="" means decorative (e.g. next to the wordmark): hidden from screen readers instead of an unnamed image.
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      {...(title === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title ?? 'VoirCheck ghost' })}
      className={cls || undefined}
      style={style}
      data-built={building ? n : undefined}
    >
      {building && !complete && (
        <g className="vc-track" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" strokeDasharray="2 2.5" opacity={0.18}>
          <path d={BODY} />
          <circle cx="50" cy="37" r="6.2" />
        </g>
      )}
      <path className={`vc-fill${complete ? '' : ' vc-off'}`} d={BODY} fill="var(--vc-ghost-fill, #fff)" />
      <circle className={`vc-fill${complete ? '' : ' vc-off'}`} cx="50" cy="37" r="6.2" fill="var(--vc-ghost-fill, #fff)" />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {PARTS.map((p, i) =>
          p.id === 'eyes' ? (
            <g key={p.id} className={`vc-eyes vc-s${i}${off(i)}`} fill="currentColor" stroke="none">
              <circle cx="27" cy="28.5" r="1.9" />
              <circle cx="36.5" cy="28.5" r="1.9" />
            </g>
          ) : (
            <path key={p.id} className={`vc-part vc-s${i}${off(i)}`} d={p.d} pathLength={1} style={{ strokeWidth: `calc(${1.8 * ('w' in p ? p.w : 1)}px * var(--vc-k))` }} />
          ),
        )}
        {showFace && (
          <g className="vc-face" data-face={mood}>
            {FACES[mood].map((d) => (
              <path key={d} className="vc-part" d={d} pathLength={1} style={{ strokeWidth: 'calc(1.8px * var(--vc-k))' }} />
            ))}
          </g>
        )}
      </g>
    </svg>
  );
}
