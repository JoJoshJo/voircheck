'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dict } from '../lib/i18n';
import { Mascot } from './Mascot';

/**
 * Hero demo (landing, spec design-pass item 1): a small looping MOCK of a check.
 * Query -> two stores check -> a Safe or Fake verdict -> the ghost reacts. ~8s
 * loop, alternating Safe/Fake. It is illustrative, not a real call, so it is
 * aria-hidden (the headline carries the meaning).
 *
 * No layout shift: the card has a reserved min-height and renders its end state
 * (Safe) on the server, so it is correct before JS and under reduced motion.
 * The loop only runs while the card is on screen and motion is allowed.
 */
const STORES = ['fairbudsaudio.example', 'sonic-haven.example'] as const;

// step: 0 query · 1 checking · 2 checks pass · 3 verdict + ghost reacts (then hold, loop)
export function HeroDemo({ t }: { t: Dict }) {
  const [step, setStep] = useState(3); // SSR/no-JS: show the finished Safe state
  const [safe, setSafe] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setStep(3);
      setSafe(true);
      return; // static end state, no loop
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    let variant = 0;
    const clear = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const run = () => {
      clear();
      const isSafe = variant % 2 === 0;
      setSafe(isSafe);
      setStep(0);
      timers.push(setTimeout(() => setStep(1), 900));
      timers.push(setTimeout(() => setStep(2), 2600));
      timers.push(setTimeout(() => setStep(3), 3800));
      timers.push(
        setTimeout(() => {
          variant += 1;
          run();
        }, 8000),
      );
    };
    let running = false;
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const visible = entries.some((e) => e.isIntersecting);
              if (visible && !running) {
                running = true;
                run();
              } else if (!visible && running) {
                running = false;
                clear();
              }
            },
            { threshold: 0.3 },
          )
        : null;
    if (io && el) io.observe(el);
    else run(); // no IO: just loop
    return () => {
      clear();
      io?.disconnect();
    };
  }, []);

  const checking = step === 1;
  const passed = step >= 2;
  const showVerdict = step >= 3;
  const tick = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );

  return (
    <div ref={ref} aria-hidden className="w-full max-w-[360px] rounded-card border border-line bg-white p-4 shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
      {/* query */}
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-ink px-3.5 py-2 text-[14px] text-white">{t.agent.example}</p>

      {/* two stores */}
      <div className="mt-3 flex gap-2">
        {STORES.map((s) => (
          <div key={s} className="flex min-w-0 flex-1 items-center gap-2 rounded-control border border-line px-2.5 py-2 text-[12px]">
            <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-surface">
              <Mascot mood="idle" size={16} title="" />
            </span>
            <span className="min-w-0 flex-1 truncate text-muted">{s}</span>
            <span className={`flex-none transition-colors duration-300 ${passed ? 'text-safe' : checking ? 'text-muted vc-run vc-run-domain_age' : 'text-faint'}`}>
              <span className="vc-m inline-flex">{tick}</span>
            </span>
          </div>
        ))}
      </div>

      {/* verdict + ghost reaction (reserved height so nothing shifts) */}
      <div className="mt-3 flex min-h-[52px] items-center gap-2">
        {showVerdict && (
          <>
            <span className={`flex items-center gap-2 rounded-control px-3 py-2 text-[14px] font-medium ${safe ? 'bg-safe-bg text-safe' : 'bg-block-bg text-block'}`}>
              {safe ? t.plain.safe : t.plain.block}
            </span>
            <span className="ml-auto flex-none">
              <Mascot mood={safe ? 'SAFE' : 'BLOCK'} size={40} faceIn title="" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
