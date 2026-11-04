import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const handleWebhook = vi.hoisted(() => vi.fn<(req: { rawBody: string }) => Promise<{ outcome: string; httpStatus: number }>>(async () => ({ outcome: 'ignored', httpStatus: 200 })));
vi.mock('@voircheck/paypal', () => ({ handleWebhook, rejectedWebhookLog: () => '' }));
vi.mock('../../../../lib/paypal', () => ({ getPayPal: () => ({ paypal: {}, store: {}, gate: {} }) }));
vi.mock('../../../../lib/user', () => ({ getProfile: vi.fn() }));
vi.mock('../../../../lib/receipts', () => ({ upsertPaymentReceipt: vi.fn() }));

const { POST } = await import('./route');
const url = 'http://localhost:3000/api/paypal/webhook';

beforeEach(() => handleWebhook.mockClear());

describe('PayPal webhook body size', () => {
  it('a Content-Length over 200 KB is refused (413) before the body is read or verified', async () => {
    let pulled = false;
    const body = new ReadableStream({
      pull(c) {
        pulled = true;
        c.enqueue(new TextEncoder().encode('x'));
        c.close();
      },
    }, { highWaterMark: 0 });
    const res = await POST(new Request(url, { method: 'POST', headers: { 'content-length': '5000000' }, body, duplex: 'half' } as RequestInit));
    expect(res.status).toBe(413);
    expect(pulled).toBe(false);
    expect(handleWebhook).not.toHaveBeenCalled();
  });

  it('a chunked body (no Content-Length) is cut off once it passes 200 KB', async () => {
    let sent = 0;
    const body = new ReadableStream({
      pull(c) {
        sent += 64_000;
        c.enqueue(new Uint8Array(64_000).fill(120));
        if (sent > 10_000_000) c.close();
      },
    });
    const res = await POST(new Request(url, { method: 'POST', body, duplex: 'half' } as RequestInit));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(1_000_000);
    expect(handleWebhook).not.toHaveBeenCalled();
  });

  it('a normal event is read whole and handed to signature verification', async () => {
    const event = JSON.stringify({ id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', pad: 'é'.repeat(1000) });
    const res = await POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: event }));
    expect(res.status).toBe(200);
    expect(handleWebhook.mock.calls[0]![0].rawBody).toBe(event);
  });
});
