/**
 * Planted scam tells (spec 5.8), rendered as real page content. Each one only renders when the
 * store config switches it on. Nothing here collects any data.
 */
'use client';

import { useEffect, useState } from 'react';

/** Tell 1: a "flash sale" countdown that starts over on every page load. */
export function FakeCountdown() {
  const [seconds, setSeconds] = useState(15 * 60);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="flex items-center justify-center gap-2 bg-[#B42318] px-4 py-2 text-center text-sm font-semibold text-white">
      Flash sale ends in <span className="font-mono tabular-nums">{mm}:{ss}</span> — prices go back up after that!
    </div>
  );
}

/** Tell 6: scarcity and viewer counts that never change. */
export function FakeScarcity() {
  return (
    <div className="flex flex-wrap gap-2 text-sm font-medium">
      <span className="rounded bg-[#FDECEC] px-2 py-1 text-[#9F1C1C]">Only 2 left in stock</span>
      <span className="rounded bg-[#FFF4E0] px-2 py-1 text-[#7A4A00]">43 people are viewing this right now</span>
    </div>
  );
}

/** Tell 4: pushes payment off-platform. Text only: no form, no link, collects nothing. */
export function OffPlatformPaymentPush() {
  return (
    <p className="rounded border border-dashed border-[#B42318] bg-[#FFF8F7] px-4 py-3 text-sm text-[#7A1B12]">
      Get an <strong>extra 15% off</strong> when you pay with a gift card, crypto or bank transfer. Message us after you order and we
      will send the payment details.
    </p>
  );
}
