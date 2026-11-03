import { describe, expect, it } from 'vitest';
import { stoppedBeforePaying, type RefusedOffer, type StoppedPayment } from './stopped';

const OUTLET = 'https://voircheck-stores.onrender.com/s/velbrook-outlet-deals';
const ONDAYA = 'https://voircheck-stores.onrender.com/s/0ndaya-home';

const pay = (over: Partial<StoppedPayment> = {}): StoppedPayment => ({ sessionId: 's1', storeUrl: OUTLET, status: 'voided', amount: '23.00', currency: 'USD', ...over });
const refusal = (over: Partial<RefusedOffer> = {}): RefusedOffer => ({ sessionId: 's1', storeUrl: OUTLET, price: '23.00', currency: 'USD', ...over });

describe('stopped before paying', () => {
  it('adds voided payments and refused BLOCK offers, per currency', () => {
    const payments = [pay({ sessionId: 's1' }), pay({ sessionId: 's2', storeUrl: ONDAYA, amount: '10.10', currency: 'EUR' }), pay({ sessionId: 's3', status: 'captured', amount: '59.00' })];
    const refused = [refusal({ sessionId: 's4', price: '19.99' })];
    expect(stoppedBeforePaying(payments, refused)).toEqual({ USD: 42.99, EUR: 10.1 });
  });

  it('counts an offer once per conversation (agent refusal + Auto-pay refusal, or the agent listing it twice)', () => {
    expect(stoppedBeforePaying([], [refusal(), refusal(), refusal()])).toEqual({ USD: 23 });
  });

  it('the same store in another conversation is another offer', () => {
    expect(stoppedBeforePaying([], [refusal({ sessionId: 's1' }), refusal({ sessionId: 's2' })])).toEqual({ USD: 46 });
  });

  it('never double counts a refused offer that also has a voided payment', () => {
    expect(stoppedBeforePaying([pay()], [refusal(), refusal()])).toEqual({ USD: 23 });
  });

  it('skips refusals where money moved or is held for that offer (the user paid anyway)', () => {
    for (const status of ['authorized', 'captured', 'refund_pending', 'refunded']) {
      expect(stoppedBeforePaying([pay({ status, amount: '23.00' })], [refusal()])).toEqual({});
    }
  });

  it('a replaced or cancelled order holds no money, so the refusal still counts', () => {
    expect(stoppedBeforePaying([pay({ status: 'replaced' }), pay({ status: 'cancelled' })], [refusal()])).toEqual({ USD: 23 });
  });

  it('skips a refused offer with no known price; empty is {}', () => {
    expect(stoppedBeforePaying([], [refusal({ price: null })])).toEqual({});
    expect(stoppedBeforePaying([], [])).toEqual({});
  });
});
