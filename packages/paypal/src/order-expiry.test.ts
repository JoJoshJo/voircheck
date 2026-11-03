import { describe, expect, it } from 'vitest';
import { ORDER_APPROVAL_WINDOW_MS, shownPaymentStatus } from './order-expiry';

const NOW = Date.parse('2026-11-03T18:00:00Z');
const ago = (ms: number) => new Date(NOW - ms);

describe('unapproved orders expire after PayPal’s window', () => {
  it('6 hours by default (PayPal Orders v2)', () => expect(ORDER_APPROVAL_WINDOW_MS).toBe(6 * 3_600_000));
  it('waiting for approval inside the window, expired after it', () => {
    expect(shownPaymentStatus({ status: 'created', createdAt: ago(5 * 3_600_000) }, NOW)).toBe('created');
    expect(shownPaymentStatus({ status: 'created', createdAt: ago(6 * 3_600_000 + 1) }, NOW)).toBe('expired');
    expect(shownPaymentStatus({ status: 'created', createdAt: ago(7 * 3_600_000).toISOString() }, NOW)).toBe('expired');
  });
  it('anything the buyer approved or that settled keeps its status, however old', () => {
    for (const status of ['approved', 'authorized', 'captured', 'voided', 'cancelled', 'failed'] as const) expect(shownPaymentStatus({ status, createdAt: ago(30 * 86_400_000) }, NOW)).toBe(status);
  });
});
