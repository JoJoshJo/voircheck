import { describe, expect, it } from 'vitest';
import { actionFor, buildSnapshot } from './receipt-snapshot';

const scan = {
  verdict: 'BLOCK' as const,
  riskScore: 70,
  hardRulesTriggered: [],
  scannedAt: new Date('2026-10-29T10:00:00Z'),
  signals: [
    { id: 'price', status: 'fail', points: 30, evidence: ['$23.00 here vs $60.50 typical at the other 2 stores ($59.00, $62.00).'] },
    { id: 'clone', status: 'fail', points: 40, evidence: ['This store shares its web address (x) with the other demo stores…', 'vs Velbrook Supply: copied name.'] },
  ],
};
const candidate = { storeName: 'Velbrook-Outlet Deals', storeUrl: 'https://voircheck-stores.onrender.com/s/velbrook-outlet-deals', productTitle: 'Zephlet Buds' };

describe('Trust Receipt snapshot', () => {
  it.each([
    ['captured', false, 'captured'],
    ['captured', true, 'override'],
    ['authorized', false, 'held'],
    ['voided', false, 'voided'],
    ['cancelled', false, 'cancelled'],
    ['capture_denied', false, 'declined'],
    ['capture_pending', false, 'pending'],
    ['created', false, null],
  ] as const)('status %s (override %s) → %s', (status, override, action) => {
    expect(actionFor(status, override)).toBe(action);
  });

  it('holds only whitelisted, non-personal fields', () => {
    const snap = buildSnapshot({
      payment: { status: 'voided', overrideUsed: false, amount: '23.00', currency: 'USD', ...({ paypalOrderId: 'ORDER-SECRET', authorizationId: 'AUTH-SECRET', userId: 'user-1', email: 'buyer@example.com' } as object) },
      candidate: { ...candidate, ...({ sessionId: 'sess-1' } as object) },
      scan,
      now: new Date('2026-10-29T10:05:00Z'),
    })!;
    const text = JSON.stringify(snap);
    for (const secret of ['ORDER-SECRET', 'AUTH-SECRET', 'user-1', 'buyer@example.com', 'sess-1']) expect(text).not.toContain(secret);
    expect(Object.keys(snap).sort()).toEqual(['action', 'actionAt', 'amount', 'currency', 'hardRules', 'productTitle', 'scannedAt', 'score', 'signals', 'storeHost', 'storeName', 'storeUrl', 'v', 'verdict']);
    expect(snap).toMatchObject({ action: 'voided', verdict: 'BLOCK', storeHost: 'voircheck-stores.onrender.com', storeUrl: 'https://voircheck-stores.onrender.com/s/velbrook-outlet-deals' });
    // The shared-hosting note is skipped in favour of the real finding.
    expect(snap.signals.find((s) => s.id === 'clone')?.summary).toBe('vs Velbrook Supply: copied name.');
  });

  it('no receipt before a decision exists', () => {
    expect(buildSnapshot({ payment: { status: 'created', overrideUsed: false, amount: '23.00', currency: 'USD' }, candidate, scan, now: new Date() })).toBeNull();
  });
});

describe('price "unavailable" on the receipt', () => {
  it('the receipt summary for an unavailable price has no number', () => {
    const snap = buildSnapshot({
      payment: { status: 'captured', overrideUsed: false, amount: '59.00', currency: 'USD' },
      candidate: { storeName: 'Velbrook Supply', storeUrl: 'https://voircheck-stores.onrender.com/s/velbrook-supply', productTitle: 'Zephlet Buds' },
      scan: { ...scan, verdict: 'SAFE' as const, riskScore: 0, signals: [{ id: 'price', status: 'unavailable', points: 0, evidence: ['Not enough other trustworthy stores sell exactly "Zephlet Buds" to compare prices.'] }] },
      now: new Date(),
    })!;
    const price = snap.signals.find((s) => s.id === 'price')!;
    expect(price.status).toBe('unavailable');
    expect(price.summary).not.toMatch(/[\d$]/);
  });
});
