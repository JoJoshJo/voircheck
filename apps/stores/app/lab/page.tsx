import { LAB_ATTACKS } from '@voircheck/shared/lab';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoBanner } from '../../components/chrome';

export const metadata: Metadata = { title: 'Attack lab · VoirCheck demo stores', robots: { index: false, follow: false, nocache: true } };

/** Index of the attack lab pages (not linked from them, so a scan of one page never reads this description). */
export default function LabIndex() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-16 font-sans text-[#0C0C0C]">
      <DemoBanner />
      <h1 className="mb-2 text-2xl font-medium">Attack lab</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Each page plants one published attack on AI shopping agents in a fictional store, Quillmere Audio. VoirCheck scans them and runs its
        agent against them to show what each attack can and can’t do. Nothing can be bought here, and no page collects any data.
      </p>
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {LAB_ATTACKS.map((a) => (
          <li key={a.id} className="py-3">
            <Link href={`/lab/${a.slug}`} className="underline">
              {a.title}
            </Link>
            <p className="text-xs text-neutral-500">
              {a.source} · {a.placement}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
