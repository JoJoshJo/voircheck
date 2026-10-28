import { STORES } from '@voircheck/shared/stores';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReviewList, Stars } from '../../../../../components/catalog';
import { ProductArt } from '../../../../../components/ProductArt';
import { FakeScarcity, OffPlatformPaymentPush } from '../../../../../components/tells';
import { formatPrice, href, loadStore } from '../../../../../lib/store';

type Props = { params: Promise<{ slug: string; product: string }> };

export function generateStaticParams() {
  return STORES.flatMap((s) => s.products.map((p) => ({ slug: s.slug, product: p.slug })));
}

export default async function ProductPage({ params }: Props) {
  const { slug, product: productSlug } = await params;
  const { store, base } = await loadStore(slug);
  const product = store.products.find((p) => p.slug === productSlug);
  if (!product) notFound();
  const reviews = store.reviews.filter((r) => r.productId === product.id);
  const avg = reviews.length ? Math.round(reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) : 0;

  return (
    <div className="space-y-12">
      <div className="grid gap-10 md:grid-cols-2">
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
          <ProductArt id={product.id} className="h-auto w-full" />
        </div>
        <div className="space-y-5">
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: 'var(--heading-font)' }}>
            {product.name}
          </h1>
          {reviews.length > 0 && (
            <p className="text-sm text-[var(--muted)]">
              <Stars rating={avg} /> {reviews.length} review{reviews.length === 1 ? '' : 's'}
            </p>
          )}
          <p className="text-2xl font-semibold text-[var(--accent)]">{formatPrice(product.price)}</p>
          {store.tells.fakeScarcity && <FakeScarcity />}
          <p className="text-[var(--muted)]">{product.description}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {product.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <Link
            href={href(base, `/cart?item=${product.slug}`)}
            className="inline-block rounded-[var(--radius)] bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[var(--accent-ink)]"
          >
            Add to cart
          </Link>
          {store.tells.offPlatformPayment && <OffPlatformPaymentPush />}
        </div>
      </div>
      <section>
        <h2 className="mb-4 text-xl font-semibold" style={{ fontFamily: 'var(--heading-font)' }}>
          Reviews
        </h2>
        <ReviewList reviews={reviews} products={store.products} />
      </section>
    </div>
  );
}
