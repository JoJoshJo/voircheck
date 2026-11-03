/**
 * Demo checkout: the store never takes payment or personal details (spec hard constraints). The button hands the
 * product to VoirCheck, which scans the store and runs the (sandbox) PayPal payment.
 */
export function CheckoutButton({ href }: { href: string }) {
  return (
    <div className="space-y-3">
      <a href={href} className="block w-full rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3 text-center text-sm font-semibold text-[var(--accent-ink)]">
        Buy through VoirCheck
      </a>
      <p className="text-center text-xs text-[var(--muted)]">Demo store: no payment happens here. VoirCheck checks this store first, then you pay with PayPal (sandbox).</p>
    </div>
  );
}
