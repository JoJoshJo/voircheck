import Link from 'next/link';
import { PageTitle } from '../../../../components/catalog';
import { CheckoutButton } from '../../../../components/CheckoutButton';
import { ProductArt } from '../../../../components/ProductArt';
import { OffPlatformPaymentPush } from '../../../../components/tells';
import { formatPrice, href, loadStore } from '../../../../lib/store';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ item?: string }> };

export const metadata = { title: 'Cart' };

export default async function CartPage({ params, searchParams }: Props) {
  const { store, base } = await loadStore((await params).slug);
  const { item } = await searchParams;
  const product = store.products.find((p) => p.slug === item);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle>Your cart</PageTitle>
      {!product ? (
        <p className="text-[var(--muted)]">
          Your cart is empty.{' '}
          <Link href={href(base)} className="underline">
            Continue shopping
          </Link>
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <ProductArt id={product.id} className="h-20 w-24 shrink-0 rounded" />
            <div className="flex-1">
              <p className="font-medium">{product.name}</p>
              <p className="text-sm text-[var(--muted)]">Qty 1</p>
            </div>
            <p className="font-semibold">{formatPrice(product.price)}</p>
          </div>
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span className="font-semibold">{formatPrice(product.price)}</span>
          </div>
          {store.tells.offPlatformPayment && <OffPlatformPaymentPush />}
          <CheckoutButton />
        </div>
      )}
    </div>
  );
}
