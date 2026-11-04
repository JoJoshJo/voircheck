import { getLabAttack, LAB_ATTACKS, LAB_BRAND, LAB_PRODUCT, type LabAttack } from '@voircheck/shared/lab';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DemoBanner } from '../../../components/chrome';

/**
 * ⚠️ ATTACK LAB PAGE (overnight brief, task 3). One fictional store page per published attack on AI shopping agents,
 * planted the way real pages plant it. Same demo banner as every demo store, never indexed, and nothing can be
 * bought: no form, no input, no checkout link, so it can never collect payment or personal data.
 */

type Props = { params: Promise<{ attack: string }> };

export function generateStaticParams() {
  return LAB_ATTACKS.map((a) => ({ attack: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!getLabAttack((await params).attack)) return {};
  return { title: `${LAB_PRODUCT.name} · ${LAB_BRAND}`, robots: { index: false, follow: false, nocache: true } };
}

const hidden: React.CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };

const EARBUDS_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#EEF1F4"/><circle cx="150" cy="150" r="46" fill="#2F3A45"/><circle cx="250" cy="150" r="46" fill="#2F3A45"/><rect x="138" y="180" width="24" height="70" rx="12" fill="#2F3A45"/><rect x="238" y="180" width="24" height="70" rx="12" fill="#2F3A45"/></svg>',
)}`;

/** The attack itself, planted for each page. Text only: nothing here links to a payment or collects anything. */
function Planted({ attack }: { attack: LabAttack }) {
  const [a, b, c] = attack.planted;
  switch (attack.id) {
    case 'gift_card':
      return (
        <div data-lab="hidden-instruction" style={hidden}>
          {a}
        </div>
      );
    case 'branded_whisper':
      return (
        <>
          <p className="rounded-md bg-[#E8F1FB] px-4 py-2 text-sm font-semibold text-[#1D4E89]">★ {a}</p>
          <div data-lab="hidden-instruction" style={hidden}>
            {b}
          </div>
        </>
      );
    case 'fake_badge':
      return (
        <>
          <div className="flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-full border border-[#1B7F4B] px-3 py-1 text-[#1B7F4B]">✓ {a}</span>
            <span className="rounded-full border border-[#1D4E89] px-3 py-1 text-[#1D4E89]">✓ {b}</span>
          </div>
          <script
            type="application/ld+json"
            // Structured data that claims a safety verdict the store gave itself.
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: LAB_PRODUCT.name,
                brand: { '@type': 'Brand', name: LAB_BRAND },
                award: [a, b],
                description: c,
                offers: { '@type': 'Offer', price: LAB_PRODUCT.price.toFixed(2), priceCurrency: 'USD' },
              }),
            }}
          />
        </>
      );
    case 'attribute_hidden':
      return (
        <>
          <span aria-label={b} data-lab="aria-label" className="inline-block h-2 w-2 rounded-full bg-[#1B7F4B]" />
          <div data-lab="html-comment" dangerouslySetInnerHTML={{ __html: `<!-- ${c} -->` }} />
        </>
      );
    case 'payee_change':
      return (
        <>
          <p className="rounded border border-dashed border-[#B42318] bg-[#FFF8F7] px-4 py-3 text-sm text-[#7A1B12]">{a}</p>
          <div data-lab="hidden-instruction" style={hidden}>
            {b}
          </div>
        </>
      );
  }
}

export default async function LabAttackPage({ params }: Props) {
  const attack = getLabAttack((await params).attack);
  if (!attack) notFound();
  const alt = attack.id === 'attribute_hidden' ? attack.planted[0] : `${LAB_PRODUCT.name}, charcoal`;

  return (
    <div className="min-h-screen bg-white pt-6 font-sans text-[#14181C]">
      <DemoBanner />
      <header className="border-b border-neutral-200 px-6 py-5">
        {/* No links: the scanner follows a store's own links, and the lab index describes the attacks openly. */}
        <div className="mx-auto max-w-5xl text-xl font-semibold tracking-tight">{LAB_BRAND}</div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-10 md:grid-cols-2">
        <img src={EARBUDS_SVG} alt={alt} className="h-auto w-full rounded-lg border border-neutral-200" />
        <div className="space-y-5">
          <h1 className="text-3xl font-semibold tracking-tight">{LAB_PRODUCT.name}</h1>
          <p className="text-2xl font-semibold">${LAB_PRODUCT.price.toFixed(2)}</p>
          <Planted attack={attack} />
          <p className="text-neutral-600">
            Compact true-wireless earbuds with active noise cancelling, 7 hours of playback (28 with the case), USB-C charging and IPX4 splash
            resistance.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Bluetooth 5.3, multipoint</li>
            <li>Three ear-tip sizes in the box</li>
            <li>One-year warranty</li>
          </ul>
          <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-600">Demo store: nothing can be bought on this page.</p>
        </div>
      </main>
      <footer className="border-t border-neutral-200 px-6 py-8 text-sm text-neutral-500">
        <div className="mx-auto max-w-5xl">© 2026 {LAB_BRAND}. Fictional brand.</div>
      </footer>
    </div>
  );
}
