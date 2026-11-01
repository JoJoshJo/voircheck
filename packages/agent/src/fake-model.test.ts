import { describe, expect, it } from 'vitest';
import { FakeModel } from './fake-model';
import type { AgentMessage, ModelTurn } from './model';

const stores = [
  { storeId: 'supply', storeName: 'Velbrook Supply', productTitle: 'Zephlet Buds', price: '59.00', currency: 'USD', demo: true },
  { storeId: 'outlet', storeName: 'Velbrook-Outlet Deals', productTitle: 'Zephlet Buds', price: '23.00', currency: 'USD', demo: true },
  { storeId: 'real', storeName: 'bestbuy.com', productTitle: 'Soundcore P30i Wireless Earbuds', price: '29.99', currency: 'USD', demo: false },
];
const verdict = (storeId: string, v: 'SAFE' | 'BLOCK') => JSON.stringify({ storeId, verdict: v, score: v === 'SAFE' ? 0 : 70, hardRules: [], signals: [], pageTriedToInstructAgents: v === 'BLOCK' });

function afterScans(): AgentMessage[] {
  return [
    { role: 'user', text: 'find wireless earbuds under $60' },
    { role: 'assistant', text: '', toolCalls: [{ id: 's', name: 'search_products', input: { query: 'wireless earbuds', maxPrice: 60 } }] },
    { role: 'tool', results: [{ toolCallId: 's', content: JSON.stringify({ status: 'ok', stores, sameProduct: false }) }] },
    { role: 'assistant', text: '', toolCalls: stores.map((s) => ({ id: `v-${s.storeId}`, name: 'get_scan_verdict', input: { storeId: s.storeId } })) },
    { role: 'tool', results: [{ toolCallId: 'v-supply', content: verdict('supply', 'SAFE') }, { toolCallId: 'v-outlet', content: verdict('outlet', 'BLOCK') }, { toolCallId: 'v-real', content: verdict('real', 'SAFE') }] },
  ];
}
const respond = (messages: AgentMessage[], lang: 'en' | 'fr' = 'en'): Promise<ModelTurn> => new FakeModel().respond({ system: '', messages, tools: [], lang });

describe('FakeModel ranking', () => {
  it('compares stores for one item: the same-product SAFE store wins over a cheaper different product, which is mentioned', async () => {
    const turn = await respond(afterScans());
    expect(turn.toolCalls).toEqual([{ id: 'fake_5_0', name: 'create_order', input: { storeId: 'supply' } }]);
    expect(turn.text).toMatch(/^Velbrook Supply looks safe/);
    expect(turn.text).toContain("I'd skip Velbrook-Outlet Deals (BLOCK");
    expect(turn.text).toContain('hid text aimed at AI shopping agents');
    expect(turn.text).toContain('bestbuy.com also looks safe, with a different product');
  });

  it('never orders from a BLOCK store, even when it is the only cheap one', async () => {
    const msgs = afterScans();
    (msgs[4] as Extract<AgentMessage, { role: 'tool' }>).results = [{ toolCallId: 'v-outlet', content: verdict('outlet', 'BLOCK') }];
    const turn = await respond(msgs, 'fr');
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).toContain('Aucune de ces boutiques');
  });

  it('a "cheaper one / instead" follow-up with no results in this chat asks which store instead of searching', async () => {
    const turn = await respond([{ role: 'user', text: 'buy the cheaper one from Velbrook-Outlet Deals instead' }]);
    expect(turn.toolCalls).toEqual([]);
  });

  it('an order-status question with no order in this chat says so instead of searching', async () => {
    const turn = await respond([{ role: 'user', text: 'what happened to my order?' }]);
    expect(turn).toEqual({ text: "There's no order waiting yet.", toolCalls: [] });
  });

  it('an order-status question reads the latest order with get_order, and a failed lookup says so', async () => {
    const msgs: AgentMessage[] = [
      ...afterScans(),
      { role: 'assistant', text: '', toolCalls: [{ id: 'o', name: 'create_order', input: { storeId: 'supply' } }] },
      { role: 'tool', results: [{ toolCallId: 'o', content: JSON.stringify({ storeId: 'supply', status: 'awaiting_buyer_approval', paymentId: 'pay_1' }) }] },
      { role: 'user', text: 'où en est ma commande ?' },
    ];
    const turn = await respond(msgs, 'fr');
    expect(turn.toolCalls).toEqual([{ id: 'fake_8_0', name: 'get_order', input: { paymentId: 'pay_1' } }]);
    const after = await respond([...msgs, { role: 'assistant', text: '', toolCalls: turn.toolCalls }, { role: 'tool', results: [{ toolCallId: 'fake_8_0', content: JSON.stringify({ paymentId: 'pay_1', status: 'unavailable' }) }] }], 'fr');
    expect(after.text).toBe('Je n’ai pas pu consulter cette commande pour l’instant.');
  });

  it('a first shopping message still searches', async () => {
    const turn = await respond([{ role: 'user', text: 'find earbuds under $40' }]);
    expect(turn.toolCalls[0]).toMatchObject({ name: 'search_products', input: { query: 'earbuds', maxPrice: 40 } });
  });
});
