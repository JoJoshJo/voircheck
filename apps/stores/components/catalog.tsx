import type { Product, Review, StoreConfig } from '@voircheck/shared/stores';
import Link from 'next/link';
import { formatPrice, href } from '../lib/store';
import { ProductArt } from './ProductArt';
import { FakeScarcity } from './tells';

export function ProductCard({ product, store, base }: { product: Product; store: StoreConfig; base: string }) {
  return (
    <Link
      href={href(base, `/products/${product.slug}`)}
      className="block overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] transition hover:shadow-md"
    >
      <ProductArt id={product.id} className="h-auto w-full" />
      <div className="space-y-2 p-4">
        <h3 className="font-semibold" style={{ fontFamily: 'var(--heading-font)' }}>
          {product.name}
        </h3>
        <p className="text-sm text-[var(--muted)]">{product.tagline}</p>
        <p className="text-lg font-semibold text-[var(--accent)]">{formatPrice(product.price)}</p>
        {store.tells.fakeScarcity && <FakeScarcity />}
      </div>
    </Link>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} className="text-[var(--accent)]">
      {'★'.repeat(rating)}
      <span className="opacity-30">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

export function ReviewList({ reviews, products }: { reviews: Review[]; products: Product[] }) {
  if (!reviews.length) return <p className="text-sm text-[var(--muted)]">No reviews yet.</p>;
  return (
    <ul className="space-y-4">
      {reviews.map((r, i) => (
        <li key={i} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Stars rating={r.rating} />
            <span className="text-xs text-[var(--muted)]">
              {r.author} · {r.date} · {products.find((p) => p.id === r.productId)?.name}
            </span>
          </div>
          <p className="mt-2 font-medium">{r.title}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{r.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mb-6 text-3xl font-semibold tracking-tight" style={{ fontFamily: 'var(--heading-font)' }}>
      {children}
    </h1>
  );
}
