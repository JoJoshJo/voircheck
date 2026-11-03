import { describe, expect, it } from 'vitest';
import { PAYMENT_REF_ALPHABET, parsePaymentRef, randomPaymentRef } from './payment-ref';

describe('payment references', () => {
  it('reads a reference however it was typed, and nothing else', () => {
    expect(parsePaymentRef(' vc-7k2f ')).toBe('VC-7K2F');
    expect(parsePaymentRef('VC-7K2O')).toBeNull(); // no O (or 0, 1, I) in the alphabet
    expect(parsePaymentRef('VC-7K2F3')).toBeNull();
    expect(parsePaymentRef('5R931449A9707780Y')).toBeNull(); // a PayPal order ID is not a reference
  });
  it('the alphabet has 32 easy-to-read characters, and generated references parse', () => {
    expect(new Set(PAYMENT_REF_ALPHABET).size).toBe(32);
    expect(PAYMENT_REF_ALPHABET).not.toMatch(/[01OI]/);
    for (let i = 0; i < 50; i++) expect(parsePaymentRef(randomPaymentRef())).not.toBeNull();
  });
});
