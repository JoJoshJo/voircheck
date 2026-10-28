import type { ProductId } from '@voircheck/shared/stores';

/** Original, simple SVG product illustrations (no photos, no logos). Colors come from the store theme. */
export function ProductArt({ id, className = '' }: { id: ProductId; className?: string }) {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-label="" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="160" fill="var(--surface)" />
      {id === 'earbuds' && <Earbuds />}
      {id === 'purifier' && <Purifier />}
      {id === 'watch' && <Watch />}
    </svg>
  );
}

function Earbuds() {
  return (
    <g>
      <rect x="62" y="96" width="76" height="40" rx="20" fill="var(--ink)" opacity="0.9" />
      <rect x="70" y="104" width="60" height="4" rx="2" fill="var(--surface)" opacity="0.4" />
      <g transform="translate(70 34) rotate(-12)">
        <ellipse cx="0" cy="22" rx="16" ry="20" fill="var(--accent)" />
        <rect x="-5" y="38" width="10" height="26" rx="5" fill="var(--accent)" />
        <circle cx="-2" cy="18" r="6" fill="var(--surface)" opacity="0.5" />
      </g>
      <g transform="translate(130 34) rotate(12)">
        <ellipse cx="0" cy="22" rx="16" ry="20" fill="var(--accent)" />
        <rect x="-5" y="38" width="10" height="26" rx="5" fill="var(--accent)" />
        <circle cx="2" cy="18" r="6" fill="var(--surface)" opacity="0.5" />
      </g>
    </g>
  );
}

function Purifier() {
  return (
    <g>
      <ellipse cx="100" cy="146" rx="44" ry="5" fill="var(--ink)" opacity="0.12" />
      <rect x="64" y="20" width="72" height="124" rx="16" fill="var(--accent)" />
      <rect x="76" y="30" width="48" height="10" rx="5" fill="var(--surface)" opacity="0.6" />
      {[56, 68, 80, 92, 104, 116].map((y) => (
        <rect key={y} x="76" y={y} width="48" height="5" rx="2.5" fill="var(--ink)" opacity="0.35" />
      ))}
      <circle cx="100" cy="132" r="3" fill="var(--surface)" />
    </g>
  );
}

function Watch() {
  return (
    <g>
      <rect x="82" y="8" width="36" height="40" rx="8" fill="var(--ink)" opacity="0.85" />
      <rect x="82" y="112" width="36" height="40" rx="8" fill="var(--ink)" opacity="0.85" />
      <rect x="62" y="40" width="76" height="80" rx="20" fill="var(--accent)" />
      <rect x="70" y="48" width="60" height="64" rx="14" fill="var(--ink)" />
      <path d="M100 80 L100 62 M100 80 L113 88" stroke="var(--surface)" strokeWidth="4" strokeLinecap="round" />
      <rect x="138" y="70" width="6" height="18" rx="3" fill="var(--accent)" />
    </g>
  );
}
