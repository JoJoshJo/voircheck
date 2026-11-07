'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Fades its content up once it scrolls into view (600 ms, globals.css `.vc-rv`); outline icons inside with
 * `vc-draw` draw themselves in. Shown at once under prefers-reduced-motion, without IntersectionObserver,
 * and without JavaScript (the landing page's <noscript> style).
 */
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      // Trigger a little before the element is fully in view (grow the viewport
      // 15% past the bottom edge) and at the first sliver, so it has settled by
      // the time it is centred — no blank boxes while scrolling.
      { threshold: 0, rootMargin: '0px 0px 15% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`vc-rv${seen ? ' vc-in' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
