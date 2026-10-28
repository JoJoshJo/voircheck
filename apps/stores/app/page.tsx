import { STORES } from '@voircheck/shared/stores';
import Link from 'next/link';
import { DemoBanner } from '../components/chrome';

// Index for path-based routing. Host-routed domains go straight to their store (see proxy.ts).
export default function DemoStoreIndex() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-16 font-sans text-[#0C0C0C]">
      <DemoBanner />
      <h1 className="mb-2 text-2xl font-medium">Fictional demo stores</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Test sites for the VoirCheck hackathon project. Every store, product and person here is made up. Nothing is for sale.
      </p>
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {STORES.map((s) => (
          <li key={s.slug} className="flex items-center justify-between py-3">
            <Link href={`/s/${s.slug}`} className="underline">
              {s.name}
            </Link>
            <span className="text-xs text-neutral-500">
              pair {s.pair} · {s.role}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
