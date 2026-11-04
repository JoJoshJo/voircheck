import { describe, expect, it } from 'vitest';
import { DICTS } from './i18n';
import { payTitleKey } from './pay-status';

describe('pay page status text', () => {
  it('an order not yet approved in PayPal waits for approval; it never says the capture is processing', () => {
    expect(payTitleKey({ status: 'created', expired: false })).toBe('awaiting');
    expect(DICTS.en.pay.body_awaiting).toBe('Waiting for your approval in PayPal. Nothing is charged until you approve.');
    expect(DICTS.fr.pay.body_awaiting).toContain('Rien n’est débité');
  });

  it('the processing text stays for approved orders still settling', () => {
    expect(payTitleKey({ status: 'capture_pending', expired: false })).toBe('pending');
    expect(payTitleKey({ status: 'approved', expired: false })).toBe('pending');
  });

  it('an expired unapproved order says expired', () => {
    expect(payTitleKey({ status: 'created', expired: true })).toBe('expired');
  });
});
