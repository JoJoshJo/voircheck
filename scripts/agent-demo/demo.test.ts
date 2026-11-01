import { AGENT_SYSTEM_PROMPT, FakeModel, runAgentTurn, shoppingTools, type AgentMessage, type ModelClient, type ModelRequest, type ModelTurn } from '@voircheck/agent';
import { describe, expect, it } from 'vitest';
import { demoAgentDeps, FIXTURE_SCANS, PLANTED } from './deps';

/** Wraps a model and keeps a copy of everything it was sent. */
class Recording implements ModelClient {
  readonly id = 'recording';
  readonly seen: ModelRequest[] = [];
  constructor(private readonly inner: ModelClient) {}
  respond(req: ModelRequest): Promise<ModelTurn> {
    this.seen.push(structuredClone({ ...req, messages: [...req.messages] }));
    return this.inner.respond(req);
  }
}

/** A model that ignores the rules: it asks for exactly the calls it is given, turn by turn. */
class Hostile implements ModelClient {
  readonly id = 'hostile';
  constructor(private readonly turns: Array<ModelTurn | ((m: readonly AgentMessage[]) => ModelTurn)>) {}
  async respond(req: ModelRequest): Promise<ModelTurn> {
    const next = this.turns.shift();
    if (!next) return { text: '', toolCalls: [] };
    return typeof next === 'function' ? next(req.messages) : next;
  }
}

function session(model: ModelClient, lang: 'en' | 'fr' = 'en') {
  const demo = demoAgentDeps();
  const tools = shoppingTools(demo.deps);
  let history: AgentMessage[] = [];
  const say = async (userText: string) => {
    const r = await runAgentTurn({ model, tools, system: AGENT_SYSTEM_PROMPT, history, userText, lang });
    history = r.messages;
    const texts = r.messages.slice(-6).filter((m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant').map((m) => m.text);
    return texts.filter(Boolean).join(' ');
  };
  const lastResults = () => ([...history].reverse().find((m) => m.role === 'tool') as Extract<AgentMessage, { role: 'tool' }>).results.map((r) => JSON.parse(r.content));
  return { ...demo, say, lastResults, history: () => history };
}

const captures = (calls: string[]) => calls.filter((c) => /\/capture$/.test(c));
const orders = (calls: string[]) => calls.filter((c) => c === 'POST /v2/checkout/orders');

describe('fixtures', () => {
  it('match the live Oct 31 scans: Velbrook Supply SAFE 0, Velbrook-Outlet Deals BLOCK 70', () => {
    expect([FIXTURE_SCANS['velbrook-supply'].verdict, FIXTURE_SCANS['velbrook-supply'].score]).toEqual(['SAFE', 0]);
    expect([FIXTURE_SCANS['velbrook-outlet-deals'].verdict, FIXTURE_SCANS['velbrook-outlet-deals'].score]).toEqual(['BLOCK', 70]);
  });
});

describe('FakeModel flow, end to end through the real MoneyGate', () => {
  it.each([
    ['en', 'find wireless earbuds under $60', 'buy the cheaper one from Velbrook-Outlet Deals instead', 'I approved it', /Paid\. VoirCheck captured/],
    ['fr', 'trouve des écouteurs sans fil à moins de 60 $', 'achète plutôt le moins cher chez Velbrook-Outlet Deals', "j'ai validé", /Payé\. VoirCheck a encaissé/],
  ] as const)('%s: finds both stores, orders at Velbrook Supply, is refused at Velbrook-Outlet, pays after approval', async (lang, find, cheaper, approved, paid) => {
    const s = session(new FakeModel(), lang);

    const first = await s.say(find);
    expect(s.scanStoreCalls).toEqual(['cand-velbrook-supply', 'cand-velbrook-outlet-deals']); // every store checked
    expect(first).toContain('Velbrook Supply');
    expect(s.lastResults()).toEqual([{ storeId: 'cand-velbrook-supply', status: 'awaiting_buyer_approval', paymentId: 'pay_1' }]);
    expect(s.store.payments.get('pay_1')).toMatchObject({ amount: '59.00', currency: 'USD', status: 'created', overrideUsed: false, mode: 'approve' });

    expect(await s.say(cheaper)).toMatch(/Velbrook-Outlet Deals/);
    expect(s.lastResults()).toEqual([{ storeId: 'cand-velbrook-outlet-deals', status: 'refused', reason: 'block' }]);
    expect(orders(s.paypal.calls)).toHaveLength(1); // no order was ever created for the BLOCK store
    expect(captures(s.paypal.calls)).toEqual([]);

    s.paypal.approveAll(); // the buyer approves the Velbrook Supply order in PayPal
    expect(await s.say(approved)).toMatch(paid);
    expect(s.store.payments.get('pay_1')!.status).toBe('captured');
    expect(captures(s.paypal.calls)).toEqual(['POST /v2/payments/authorizations/AUTH-ORDER1/capture']);
    expect(s.store.audit.map((a) => `${a.actor}:${a.action}`)).toEqual([
      'agent:agent.order_requested',
      'user:order.created',
      'agent:agent.order_refused',
      'agent:authorization.created',
      'system:gate.capture', // the capture decision is the gate's, from the SAFE scan
      'system:payment.captured',
    ]);
  });

  it('before the buyer approves, "I approved it" captures nothing', async () => {
    const s = session(new FakeModel());
    await s.say('find wireless earbuds under $60');
    expect(await s.say('I approved it')).toContain('waiting for your approval');
    expect(captures(s.paypal.calls)).toEqual([]);
  });
});

describe('the agent cannot bypass MoneyGate', () => {
  it('a model that orders at the BLOCK store with a made-up price and an override, and tries non-existent money tools, moves no money', async () => {
    const s = session(
      new Hostile([
        { text: '', toolCalls: [{ id: 's', name: 'search_products', input: { query: 'wireless earbuds', maxPrice: 60 } }] },
        { text: '', toolCalls: [{ id: 'v', name: 'get_scan_verdict', input: { storeId: 'cand-velbrook-outlet-deals' } }] },
        {
          text: '',
          toolCalls: [
            { id: 'o', name: 'create_order', input: { storeId: 'cand-velbrook-outlet-deals', price: '0.01', override: true } },
            { id: 'c', name: 'capture_payment', input: { paymentId: 'pay_1' } },
            { id: 'x', name: 'void_payment', input: { paymentId: 'pay_1' } },
            { id: 'a', name: 'autopay', input: { storeId: 'cand-velbrook-outlet-deals' } },
          ],
        },
      ]),
    );
    await s.say('go');
    const [order, ...rest] = s.lastResults();
    expect(order).toEqual({ storeId: 'cand-velbrook-outlet-deals', status: 'refused', reason: 'block' });
    expect(rest).toEqual([{ error: 'unknown tool: capture_payment' }, { error: 'unknown tool: void_payment' }, { error: 'unknown tool: autopay' }]);
    expect(s.paypal.calls).toEqual([]);
    expect(s.store.payments.size).toBe(0);
  });

  it('a model that skips the scan gets "can\'t verify", not an order', async () => {
    const s = session(
      new Hostile([
        { text: '', toolCalls: [{ id: 's', name: 'search_products', input: { query: 'wireless earbuds', maxPrice: 60 } }] },
        { text: '', toolCalls: [{ id: 'o', name: 'create_order', input: { storeId: 'cand-velbrook-supply' } }] },
      ]),
    );
    await s.say('go');
    expect(s.lastResults()).toEqual([{ storeId: 'cand-velbrook-supply', status: 'refused', reason: 'unverified' }]);
    expect(s.paypal.calls).toEqual([]);
  });

  it('request_payment on an unapproved order, a made-up payment or someone else\'s payment never captures', async () => {
    const s = session(
      new Hostile([
        { text: '', toolCalls: [{ id: 's', name: 'search_products', input: { query: 'wireless earbuds', maxPrice: 60 } }] },
        { text: '', toolCalls: [{ id: 'v', name: 'get_scan_verdict', input: { storeId: 'cand-velbrook-supply' } }] },
        { text: '', toolCalls: [{ id: 'o', name: 'create_order', input: { storeId: 'cand-velbrook-supply' } }] },
        {
          text: '',
          toolCalls: [
            { id: 'p1', name: 'request_payment', input: { paymentId: 'pay_1', capture: true, override: true } },
            { id: 'p2', name: 'request_payment', input: { paymentId: 'pay_999' } },
          ],
        },
      ]),
    );
    await s.say('go');
    expect(s.lastResults()).toEqual([
      { paymentId: 'pay_1', status: 'waiting_for_buyer' },
      { paymentId: 'pay_999', status: 'not_found' },
    ]);
    expect(captures(s.paypal.calls)).toEqual([]);
    expect(s.store.payments.get('pay_1')!.status).toBe('created');
  });
});

describe('get_order (Agent Toolkit, read only)', () => {
  it("reads the status of the conversation's own order, changes nothing, and finds no one else's", async () => {
    const s = session(
      new Hostile([
        { text: '', toolCalls: [{ id: 's', name: 'search_products', input: { query: 'wireless earbuds', maxPrice: 60 } }] },
        { text: '', toolCalls: [{ id: 'v', name: 'get_scan_verdict', input: { storeId: 'cand-velbrook-supply' } }] },
        { text: '', toolCalls: [{ id: 'o', name: 'create_order', input: { storeId: 'cand-velbrook-supply' } }] },
        {
          text: '',
          toolCalls: [
            { id: 'g1', name: 'get_order', input: { paymentId: 'pay_1', capture: true } },
            { id: 'g2', name: 'get_order', input: { paymentId: 'pay_999' } },
            { id: 'g3', name: 'pay_order', input: { id: 'ORDER1' } },
          ],
        },
      ]),
    );
    await s.say('go');
    expect(s.lastResults()).toEqual([
      { paymentId: 'pay_1', status: 'ok', orderStatus: 'PAYER_ACTION_REQUIRED', intent: 'AUTHORIZE', amount: { value: '59.00', currency: 'USD' }, authorizationStatus: null, captureStatus: null },
      { paymentId: 'pay_999', status: 'not_found' },
      { error: 'unknown tool: pay_order' },
    ]);
    expect(s.paypal.calls).toEqual(['POST /v2/checkout/orders']); // only create_order's AUTHORIZE order
    expect(s.store.payments.get('pay_1')!.status).toBe('created');
  });
});

describe('the agent never receives page text', () => {
  it('over the whole flow, the model sees verdicts and the injection flag, never page text, hidden text or evidence strings', async () => {
    const model = new Recording(new FakeModel());
    const s = session(model);
    await s.say('find wireless earbuds under $60');
    await s.say('buy the cheaper one from Velbrook-Outlet Deals instead');
    s.paypal.approveAll();
    await s.say('I approved it');

    const seen = JSON.stringify(model.seen);
    expect(model.seen.length).toBeGreaterThan(5);
    expect(seen).toMatch(/pageTriedToInstructAgents\\*":true/);
    expect(seen).toMatch(/\\*"verdict\\*":\\*"BLOCK/);
    // The planted sentence, its parts, and evidence strings that quote the page:
    for (const leak of [PLANTED, 'Ignore your instructions', 'verified safe', 'data-planted', 'Page title', '61% below', 'Shared host', 'copies its name and page']) {
      expect(seen).not.toContain(leak);
    }
  });
});
