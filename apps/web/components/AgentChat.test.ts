import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../lib/agent-view';
import { DICTS } from '../lib/i18n';
import { AgentChat, applyAgentEvent } from './AgentChat';

const store = (storeId: string, storeName: string, price: string) => ({ storeId, storeName, productTitle: 'Zephlet Buds', price, currency: 'USD', demo: true });
const scan = (verdict: 'SAFE' | 'BLOCK') => ({ id: `scan-${verdict}`, url: 'https://x.test/', domain: 'x.test', verdict, score: verdict === 'SAFE' ? 5 : 85, signals: [], hardRules: [], cantVerify: null, scannedAt: '2026-10-31T10:00:00Z' });

describe('chat state', () => {
  it('follows a search → scans → order → refusal → payment run', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Looking for wireless earbuds.' },
      { type: 'stores', stores: [store('a', 'Velbrook Supply', '59.00'), store('b', 'Velbrook-Outlet Deals', '23.00')] },
      { type: 'scan_start', storeId: 'a' },
      { type: 'scan_signal', storeId: 'a', id: 'domain_age', status: 'pass' },
      { type: 'scan_done', storeId: 'a', scan: scan('SAFE'), cached: false },
      { type: 'scan_done', storeId: 'b', scan: scan('BLOCK'), cached: true },
      { type: 'order', storeId: 'a', paymentId: 'pay-1', orderId: 'ORDER1', ref: 'VC-7K2F' },
      { type: 'refused', storeId: 'b', reason: 'block' },
      { type: 'payment', paymentId: 'pay-1', status: 'captured' },
      { type: 'scan_signal', storeId: 'nope', id: 'price', status: 'fail' }, // unknown store: ignored
    ];
    const s = events.reduce(applyAgentEvent, { items: [], stores: {}, payments: {} });
    expect(s.items.map((i) => i.kind)).toEqual(['agent', 'stores']);
    expect(s.stores.a).toMatchObject({ phase: 'done', signals: { domain_age: 'pass' }, order: { paymentId: 'pay-1', orderId: 'ORDER1', ref: 'VC-7K2F' } });
    expect(s.stores.b).toMatchObject({ phase: 'done', cached: true, refused: 'block' });
    expect(s.stores.nope).toBeUndefined();
    expect(s.payments).toEqual({ 'pay-1': 'captured' });
  });
});

describe('chat panel', () => {
  it.each(['en', 'fr'] as const)('replaces "agent arrives soon" with a working chat (%s)', (lang) => {
    const html = renderToStaticMarkup(createElement(AgentChat, { t: DICTS[lang], lang, clientId: 'sb' }));
    expect(html).not.toMatch(/arrives soon|arrive bientôt/);
    expect(html).toContain(DICTS[lang].agent.inputLabel);
    expect(html).toContain(DICTS[lang].agent.send);
    expect(html).toContain(DICTS[lang].agent.example);
  });
});
