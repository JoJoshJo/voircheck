/**
 * VoirCheck mascot (spec 5.12): minimal black line-art ghost holding a magnifying glass.
 * Floats and sweeps the glass while scanning; expression follows the verdict. Animations are disabled under
 * prefers-reduced-motion (globals.css).
 */
export type MascotMood = 'scanning' | 'SAFE' | 'HOLD' | 'BLOCK' | 'idle';

const INK = '#0C0C0C';

function Face({ mood }: { mood: MascotMood }) {
  const s = { stroke: INK, strokeWidth: 1.8, strokeLinecap: 'round' as const, fill: 'none' };
  switch (mood) {
    case 'SAFE': // relaxed: closed, smiling eyes and a soft smile
      return (
        <g {...s}>
          <path d="M23 28.5q2.5-2.6 5 0" />
          <path d="M33 28.5q2.5-2.6 5 0" />
          <path d="M26.5 35q4 3 8 0" />
        </g>
      );
    case 'HOLD': // curious: one raised brow, eyes glancing at the glass, flat mouth
      return (
        <g>
          <path d="M22.5 23.5l5-1.5" {...s} />
          <circle cx="26.5" cy="28.5" r="1.9" fill={INK} />
          <circle cx="36" cy="28.5" r="1.9" fill={INK} />
          <path d="M27.5 35.5h6" {...s} />
        </g>
      );
    case 'BLOCK': // alarmed: wide eyes, raised brows, open mouth
      return (
        <g>
          <path d="M22 23l5 1M39 23l-5 1" {...s} />
          <circle cx="25.5" cy="28.5" r="3" fill="#fff" stroke={INK} strokeWidth={1.8} />
          <circle cx="36" cy="28.5" r="3" fill="#fff" stroke={INK} strokeWidth={1.8} />
          <circle cx="25.5" cy="28.5" r="1" fill={INK} />
          <circle cx="36" cy="28.5" r="1" fill={INK} />
          <ellipse cx="30.8" cy="36.5" rx="2.4" ry="3" fill="none" stroke={INK} strokeWidth={1.8} />
        </g>
      );
    default: // scanning / idle: focused, looking toward the glass
      return (
        <g>
          <circle cx="27" cy="28.5" r="1.9" fill={INK} />
          <circle cx="36.5" cy="28.5" r="1.9" fill={INK} />
          <path d="M29.5 35.2q2 1.2 4 0" {...s} />
        </g>
      );
  }
}

export function Mascot({ mood = 'idle', size = 64, title }: { mood?: MascotMood; size?: number; title?: string }) {
  const scanning = mood === 'scanning';
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title ?? 'VoirCheck ghost'} className={scanning ? 'vc-float' : undefined}>
      <path
        d="M14 54V29a16.5 16.5 0 0 1 33 0v25l-5.5-4-5.5 4-5.5-4-5.5 4-5.5-4z"
        fill="#fff"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Face mood={mood} />
      <g className={scanning ? 'vc-scan' : undefined}>
        <path d="M43.5 41.5q3.5-.5 4.6 2.2" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
        <circle cx="50" cy="37" r="6.2" fill="#fff" stroke={INK} strokeWidth={1.8} />
        <path d="M47.2 34.6q1.4-1.6 3.6-1.4" fill="none" stroke={INK} strokeWidth={1.2} strokeLinecap="round" opacity={0.5} />
        <path d="M54.4 41.4l4.4 4.4" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      </g>
    </svg>
  );
}
