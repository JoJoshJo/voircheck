import { PolicyPage } from '../../../../../components/PolicyPage';
import { loadStore } from '../../../../../lib/store';

export const metadata = { title: 'Shipping policy' };

export default async function ShippingPolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { store } = await loadStore((await params).slug);
  return <PolicyPage title="Shipping policy" paragraphs={store.policies.shipping} />;
}
