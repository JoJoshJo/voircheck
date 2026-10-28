import { PageTitle, ReviewList } from '../../../../components/catalog';
import { loadStore } from '../../../../lib/store';

export const metadata = { title: 'Reviews' };

export default async function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { store } = await loadStore((await params).slug);
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle>Customer reviews</PageTitle>
      <ReviewList reviews={store.reviews} products={store.products} />
    </div>
  );
}
