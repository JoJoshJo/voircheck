import Link from 'next/link';
import { PageTitle, ProductCard, ReviewList } from '../../../components/catalog';
import { ProductArt } from '../../../components/ProductArt';
import { OffPlatformPaymentPush } from '../../../components/tells';
import { href, loadStore } from '../../../lib/store';

export default async function StoreHome({ params }: { params: Promise<{ slug: string }> }) {
  const { store, theme, base } = await loadStore((await params).slug);
  const hero = store.products[0]!;
  const cta = (
    <Link
      href={href(base, `/products/${hero.slug}`)}
      className="inline-block rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-ink)]"
    >
      Shop {hero.name}
    </Link>
  );

  return (
    <div className="space-y-12">
      {theme.layout === 'classic' && (
        <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-8 py-14 text-center">
          <PageTitle>{store.heroTitle}</PageTitle>
          <p className="mx-auto mb-8 max-w-xl text-[var(--muted)]">{store.heroBody}</p>
          {cta}
        </section>
      )}
      {theme.layout === 'split' && (
        <section className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <PageTitle>{store.heroTitle}</PageTitle>
            <p className="mb-8 text-[var(--muted)]">{store.heroBody}</p>
            {cta}
          </div>
          <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
            <ProductArt id={hero.id} className="h-auto w-full" />
          </div>
        </section>
      )}
      {theme.layout === 'bold' && (
        <section className="rounded-[var(--radius)] bg-[var(--accent)] px-8 py-12 text-[var(--accent-ink)]">
          <h1 className="mb-4 text-4xl font-bold tracking-tight" style={{ fontFamily: 'var(--heading-font)' }}>
            {store.heroTitle}
          </h1>
          <p className="mb-8 max-w-2xl text-white/90">{store.heroBody}</p>
          <Link href={href(base, `/products/${hero.slug}`)} className="inline-block rounded-[var(--radius)] bg-[var(--accent-ink)] px-5 py-3 text-sm font-bold text-[var(--accent)]">
            Shop {hero.name}
          </Link>
        </section>
      )}

      {store.tells.offPlatformPayment && <OffPlatformPaymentPush />}

      <section>
        <h2 className="mb-4 text-xl font-semibold" style={{ fontFamily: 'var(--heading-font)' }}>
          Our products
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {store.products.map((p) => (
            <ProductCard key={p.id} product={p} store={store} base={base} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold" style={{ fontFamily: 'var(--heading-font)' }}>
            What customers say
          </h2>
          <Link href={href(base, '/reviews')} className="text-sm underline">
            All reviews
          </Link>
        </div>
        <ReviewList reviews={store.reviews.slice(0, 3)} products={store.products} />
      </section>
    </div>
  );
}
