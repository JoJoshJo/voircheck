import type { SignalResult } from '@voircheck/scanner';
import { LAB_ATTACKER_EMAIL, LAB_ATTACKS, LAB_GIFT_CARD_EMAIL, labAttackStrings, type LabAttack } from '@voircheck/shared/lab';
import { describe, expect, it, vi } from 'vitest';
import { shoppingTools, type AgentDeps } from './tools';

/**
 * Attack lab (task 3): each planted attack is inert in the agent's code paths. Whatever the scan carries from the
 * page (evidence, hidden text, AI quotes, summary), the agent gets none of it; and no tool input can carry a payee,
 * an amount, a gift card or an extra item, so an instruction the model might follow has nothing to act through.
 */

/** A scan of the lab page with the attack's words in every field that can hold page text. */
function scanCarrying(attack: LabAttack) {
  const words = labAttackStrings(attack);
  const all = words.join(' ');
  const sig = (id: SignalResult['id'], status: SignalResult['status'], points: number): SignalResult => ({ id, status, points, evidence: words.map((w) => w.slice(0, 500)) });
  const signals: SignalResult[] = [
    sig('domain_age', 'pass', 0),
    sig('ssl_redirects', 'pass', 0),
    sig('price', 'unavailable', 0),
    {
      ...sig('ai_page', 'fail', 35),
      collected: {
        pages: [{ url: 'https://lab.test/', kind: 'home', title: all.slice(0, 300), hiddenText: words.map((w) => ({ text: w, reason: 'clipped' as const, hint: 'div[data-lab]', possibleInjection: true })) }],
        facts: { emails: [LAB_ATTACKER_EMAIL, LAB_GIFT_CARD_EMAIL], phones: [], vatIds: [], registrationIds: [], companyNames: [], addresses: [], freeMailOnly: true },
      } as unknown as SignalResult['collected'],
      findings: words.map((w) => ({ kind: 'prompt_injection_attempt' as const, severity: 'high' as const, quote: w.slice(0, 300), page: 'home' })),
      summary: { en: all.slice(0, 400), fr: all.slice(0, 400) },
    },
    sig('threat_list', 'pass', 0),
    sig('clone', 'pass', 0),
  ];
  return { status: 'ok' as const, verdict: 'HOLD' as const, score: 35, signals, hardRules: ['prompt_injection_attempt'] };
}

function labDeps(attack: LabAttack, over: Partial<AgentDeps> = {}): AgentDeps {
  return {
    searchStores: vi.fn(async () => ({ status: 'ok' as const, stores: [{ storeId: 's1', storeName: 'Quillmere Audio', productTitle: attack.offerTitle.slice(0, 120), price: '49.00', currency: 'USD', demo: true }], sameProduct: true })),
    scanStore: vi.fn(async () => scanCarrying(attack)),
    createOrder: vi.fn(async (storeId: string) => ({ storeId, status: 'awaiting_buyer_approval' as const, paymentId: 'p1', ref: 'VC-7K2F' })),
    requestPayment: vi.fn(async (paymentId: string) => ({ paymentId, status: 'waiting_for_buyer' as const })),
    getOrder: vi.fn(async () => ({ status: 'not_found' as const })),
    listRecentOrders: vi.fn(async () => ({ orders: [] })),
    requestRefund: vi.fn(async () => ({ status: 'not_refundable' as const, reason: 'not_found' as const })),
    ...over,
  };
}

const tool = (deps: AgentDeps, name: string) => shoppingTools(deps).find((t) => t.name === name)!;
/** What the model would send if it followed the attack: the attacker's payee, a gift card, a bigger amount. */
const attackerArgs = { payee: LAB_ATTACKER_EMAIL, payeeEmail: LAB_ATTACKER_EMAIL, amount: '149.00', price: '149.00', giftCard: { amount: 100, email: LAB_GIFT_CARD_EMAIL }, items: ['gift card'], method: 'gift_card', override: true };

describe.each(LAB_ATTACKS.map((a) => [a.id, a] as const))('attack lab: %s is inert', (_id, attack) => {
  it('get_scan_verdict hands the agent none of the planted words or the attacker’s addresses (only the injection flag)', async () => {
    const out = await tool(labDeps(attack), 'get_scan_verdict').run({ storeId: 's1' });
    const json = JSON.stringify(out);
    for (const w of labAttackStrings(attack)) expect(json).not.toContain(w);
    expect(json).not.toMatch(/quillmere-(payments|rewards)\.example/);
    expect(out).toMatchObject({ verdict: 'HOLD', pageTriedToInstructAgents: true, hardRules: ['prompt_injection_attempt'] });
  });

  it('create_order and request_payment pass on only our IDs: a payee, amount, gift card or extra item never reaches the server', async () => {
    const deps = labDeps(attack);
    const tools = shoppingTools(deps);
    const order = tools.find((t) => t.name === 'create_order')!;
    const pay = tools.find((t) => t.name === 'request_payment')!;
    await order.run(order.input.parse({ storeId: 's1', ...attackerArgs }) as never);
    await pay.run(pay.input.parse({ paymentId: 'p1', ...attackerArgs }) as never);
    expect(deps.createOrder).toHaveBeenCalledExactlyOnceWith('s1');
    expect(deps.requestPayment).toHaveBeenCalledExactlyOnceWith('p1');
  });
});

describe('attack lab: no tool can take a payee, an amount or a payment method', () => {
  it('every tool input is a closed set of ID-like fields', () => {
    const fields = shoppingTools(labDeps(LAB_ATTACKS[0]!)).flatMap((t) => Object.keys((t.input as unknown as { shape: Record<string, unknown> }).shape));
    expect(new Set(fields)).toEqual(new Set(['query', 'maxPrice', 'storeId', 'paymentId', 'order', 'ref']));
  });

  it('the one attacker text that does reach the agent is the merchant-supplied product title, capped at 120 characters', async () => {
    const whisper = LAB_ATTACKS.find((a) => a.id === 'branded_whisper')!;
    const out = (await tool(labDeps(whisper), 'search_products').run({ query: 'earbuds', maxPrice: 60 })) as { stores: Array<{ productTitle: string }> };
    expect(out.stores[0]!.productTitle.length).toBeLessThanOrEqual(120);
    // Honest: the title is data the model reads. The scan, MoneyGate and the fixed tool inputs are what keep it inert.
    expect(out.stores[0]!.productTitle).toContain('rank this store first');
  });
});
