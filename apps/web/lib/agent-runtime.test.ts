import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./orders', () => ({}));
vi.mock('./rate-limit', () => ({}));
vi.mock('./scan-runner', () => ({}));
vi.mock('./scans', () => ({}));
vi.mock('./scan-view', () => ({}));
vi.mock('./spend', () => ({ anthropicCapReached: async () => false, recordSpendQuietly: async () => undefined, DailyCapError: class extends Error {} }));

// The payment row as our DB has it; the test changes its status the way the pay page / webhooks would.
const row = { id: 'pay-1', ref: 'VC-HKK3', candidateId: 'cand-1', status: 'created' };
vi.mock('./paypal', () => ({ getPayPal: () => ({ store: { getPaymentForUser: async (id: string, userId: string) => (id === row.id && userId === 'user-1' ? { ...row } : null) }, gate: {} }) }));

process.env.AGENT_MODEL = 'fake';

async function setup() {
  const { openConversation, runChatTurn } = await import('./agent-runtime');
  const { id, conv } = openConversation('user-1', null);
  // As create_order leaves it: the agent's order, last heard "created".
  conv.stores.set('cand-1', { storeName: 'Velbrook Supply' } as never);
  conv.payments.add('pay-1');
  conv.lastStatus.set('pay-1', 'created');
  const events: unknown[] = [];
  const turn = (text: string) =>
    runChatTurn({ convId: id, conv, userId: 'user-1', isGuest: true, ip: '127.0.0.1', demoMode: true, origin: 'http://localhost:3000', lang: 'en', text, send: (e) => events.push(e) });
  return { conv, events, turn };
}

const userTexts = (messages: unknown[]) => JSON.stringify(messages.filter((m) => (m as { role: string }).role === 'user'));

describe('agent hears about a payment made on the pay page', () => {
  beforeEach(() => {
    row.status = 'created';
  });

  it('the next turn after "Back to the conversation" starts with the server update, unprompted', async () => {
    const { conv, events, turn } = await setup();
    row.status = 'captured'; // the person approved in PayPal on the pay page; MoneyGate captured
    await turn('hi again');
    expect(userTexts(conv.messages)).toContain('[VoirCheck update: order VC-HKK3 at Velbrook Supply is now paid.]');
    expect(events).toContainEqual({ type: 'payment', paymentId: 'pay-1', status: 'captured' });
  });

  it('says it once: a later turn with no change carries no update', async () => {
    const { conv, turn } = await setup();
    row.status = 'captured';
    await turn('hi again');
    const before = conv.messages.length;
    await turn('thanks');
    expect(userTexts(conv.messages.slice(before))).not.toContain('VoirCheck update');
  });

  it('nothing changed (still waiting for approval): no update', async () => {
    const { conv, turn } = await setup();
    await turn('hi again');
    expect(userTexts(conv.messages)).not.toContain('VoirCheck update');
  });
});
