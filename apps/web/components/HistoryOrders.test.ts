import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DICTS } from '../lib/i18n';
import type { OrderCard } from '../lib/orders-history';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const card = (over: Partial<OrderCard>): OrderCard => ({
  paymentId: 'pay-1',
  ref: 'VC-7K2F',
  store: 'Velbrook Supply',
  item: 'Zephlet Buds',
  amount: '59.00',
  currency: 'USD',
  at: '2026-11-03T18:20:00.000Z',
  status: 'paid',
  receiptSlug: 'slug-1',
  scanId: 'scan-1',
  refundable: true,
  needsYou: false,
  ...over,
});

async function render(orders: OrderCard[], lang: 'en' | 'fr' = 'en', stopped: Record<string, number> = {}) {
  const { HistoryOrders } = await import('./HistoryOrders');
  return renderToStaticMarkup(createElement(HistoryOrders, { orders, stopped, t: DICTS[lang], lang }));
}

const items = (html: string) => html.split('<li ').slice(1);

describe('History → Orders cards', () => {
  it('one status pill per card, and Request refund only on the paid one', async () => {
    const html = await render([
      card({ paymentId: 'a', ref: 'VC-GVLZ', status: 'refunded', refundable: false }),
      card({ paymentId: 'b', ref: 'VC-NV8S', status: 'replaced', refundable: false, receiptSlug: null }),
      card({ paymentId: 'c', ref: 'VC-7K2F', status: 'paid' }),
    ]);
    const [refunded, replaced, paid] = items(html);
    for (const li of [refunded!, replaced!, paid!]) expect(li.match(/rounded-full px-2\.5/g)).toHaveLength(1);
    expect(refunded).toContain('>Refunded<');
    expect(replaced).toContain('Replaced, nothing charged');
    expect(paid).toContain('>Paid<');
    expect(refunded).not.toContain('Request refund');
    expect(replaced).not.toContain('Request refund');
    expect(paid).toContain('Request refund');
  });

  it('links Receipt and Evidence (the scan the order was decided on)', async () => {
    const [li] = items(await render([card({ scanId: 'scan-chat-1', receiptSlug: 'abc' })]));
    expect(li).toContain('href="/r/abc"');
    expect(li).toContain('href="/app/scans/scan-chat-1"');
  });

  it('a waiting order offers Approve in PayPal; a held one, Decide', async () => {
    const [waiting, held] = items(await render([card({ paymentId: 'w', status: 'waiting', needsYou: true, refundable: false, receiptSlug: null }), card({ paymentId: 'h', status: 'held', needsYou: true, refundable: false })]));
    expect(waiting).toContain('href="/app/pay/w"');
    expect(waiting).toContain('Approve in PayPal');
    expect(held).toContain('href="/app/pay/h"');
    expect(held).toContain('>Decide<');
  });

  it('shows the four totals, in French too', async () => {
    const html = await render([card({ status: 'paid', amount: '24.00' }), card({ paymentId: 'v', status: 'voided', amount: '23.00', refundable: false })], 'fr');
    for (const label of ['Payé', 'Remboursé', 'Arrêtés avant paiement', 'En attente de vous']) expect(html).toContain(label);
    expect(html).toContain('Demander un remboursement');
  });

  it('shows Stopped before paying from the server total, with its helper text', async () => {
    const html = await render([], 'en', { USD: 42.99 });
    expect(html).toContain('Stopped before paying');
    expect(html).toContain('$42.99');
    expect(html).toContain('Purchases VoirCheck stopped at a scam store before any money moved.');
  });

  it('says so when there are no orders', async () => {
    expect(await render([])).toContain('No orders yet.');
  });
});
