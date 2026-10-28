'use client';

import { useState } from 'react';

/** Demo checkout: never collects payment or personal details (spec hard constraints). */
export function CheckoutButton() {
  const [clicked, setClicked] = useState(false);
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setClicked(true)}
        className="w-full rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-ink)]"
      >
        Checkout
      </button>
      {clicked && (
        <p role="status" className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          Demo store. Purchases happen through VoirCheck.
        </p>
      )}
    </div>
  );
}
