import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../lib/agent-view';
import { DICTS } from '../lib/i18n';
import { AgentChat, applyAgentEvent, applyRefundResult, buyMessage, StoreCard } from './AgentChat';

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

  it('a refund offer adds one card (offered twice → still one) and keeps the payment’s known status', () => {
    const offer: AgentEvent = { type: 'refund_offer', paymentId: 'pay-1', ref: 'VC-7K2F', store: 'Velbrook Supply', amount: '59.00', currency: 'USD' };
    const s = [offer, offer].reduce(applyAgentEvent, { items: [], stores: {}, payments: {} });
    expect(s.items).toEqual([{ kind: 'refund', paymentId: 'pay-1', ref: 'VC-7K2F', store: 'Velbrook Supply', amount: '59.00', currency: 'USD' }]);
    expect(s.payments).toEqual({ 'pay-1': 'captured' });
    const later = applyAgentEvent({ ...s, payments: { 'pay-1': 'refunded' } }, offer);
    expect(later.payments['pay-1']).toBe('refunded');
  });

  it('after the refund button works, a confirmation line follows the agent’s message (EN + FR, pending too)', () => {
    const s = { items: [{ kind: 'agent' as const, text: 'Tap the button to confirm.' }], stores: {}, payments: { 'pay-1': 'captured' } };
    const done = applyRefundResult(s, DICTS.en, { paymentId: 'pay-1', ref: 'VC-GVLZ' }, 'refunded', '$59.00');
    expect(done.payments['pay-1']).toBe('refunded');
    expect(done.items.at(-1)).toEqual({ kind: 'agent', text: 'Done: PayPal refunded $59.00 for VC-GVLZ to your PayPal account.' });
    expect(applyRefundResult(s, DICTS.fr, { paymentId: 'pay-1', ref: 'VC-GVLZ' }, 'refund_pending', '59,00 $US').items.at(-1)).toMatchObject({ text: expect.stringContaining('Remboursement demandé pour VC-GVLZ') });
  });

  it('"Buy this" shows on SAFE and HOLD cards without an order; never on BLOCK, refused or ordered ones', () => {
    const card = (verdict: 'SAFE' | 'HOLD' | 'BLOCK', extra: object = {}) =>
      renderToStaticMarkup(createElement(StoreCard, { t: DICTS.en, lang: 'en', clientId: 'x', s: { store: store('a', 'Velbrook Supply', '59.00'), phase: 'done', signals: {}, scan: { ...scan(verdict === 'BLOCK' ? 'BLOCK' : 'SAFE'), verdict }, ...extra }, payments: { 'pay-1': 'captured' }, busy: false, onBuy: () => {} }));
    expect(card('SAFE')).toContain('>Buy this<');
    expect(card('HOLD')).toContain('>Buy this<');
    expect(card('BLOCK')).not.toContain('Buy this');
    expect(card('SAFE', { refused: 'other' })).not.toContain('Buy this');
    expect(card('SAFE', { order: { paymentId: 'pay-1', orderId: 'O1', ref: 'VC-7K2F' } })).not.toContain('>Buy this<');
  });

  it('"Buy this" sends the person’s own choice; on HOLD it says they saw the Hold result', () => {
    expect(buyMessage(DICTS.en, 'Velbrook Supply', 'SAFE')).toBe('Buy it at Velbrook Supply.');
    expect(buyMessage(DICTS.en, 'Nyuie Market', 'HOLD')).toBe('Buy it at Nyuie Market. I’ve seen the Hold result and want to go ahead.');
    expect(buyMessage(DICTS.fr, 'Nyuie Market', 'HOLD')).toContain('En attente');
  });

  it('the refund card is a button the person presses: the agent’s offer alone moves nothing', async () => {
    const { RefundButton } = await import('./RefundButton');
    const html = renderToStaticMarkup(createElement(RefundButton, { t: DICTS.fr, paymentId: 'pay-1', refLabel: 'VC-7K2F', amount: '59,00 $US', status: 'captured' }));
    expect(html).toContain('Demander le remboursement de VC-7K2F, 59,00 $US');
    expect(renderToStaticMarkup(createElement(RefundButton, { t: DICTS.en, paymentId: 'pay-1', refLabel: 'VC-7K2F', amount: '$59.00', status: 'refunded' }))).toContain('Refunded.');
    expect(renderToStaticMarkup(createElement(RefundButton, { t: DICTS.en, paymentId: 'pay-1', refLabel: 'VC-7K2F', amount: '$59.00', status: 'voided' }))).toBe('');
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
