import { PolicyPage } from '../../../../../components/PolicyPage';
import { loadStore } from '../../../../../lib/store';

export const metadata = { title: 'Refund policy' };

export default async function RefundPolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { store } = await loadStore((await params).slug);
  return <PolicyPage title="Refund policy" paragraphs={store.policies.refund} />;
}
