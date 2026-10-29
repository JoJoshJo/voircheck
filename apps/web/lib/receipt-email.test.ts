import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReceiptEmail, topReasons } from './receipt-email';
import { DEFAULT_EMAIL_FROM, deliverReceiptEmail, resetNoKeyWarning, type MailerDeps, type ResendLike } from './receipt-mailer';
import type { ReceiptSnapshot } from './receipt-snapshot';

const snapshot = (over: Partial<ReceiptSnapshot> = {}): ReceiptSnapshot => ({
  v: 1,
  storeName: 'Velbrook-Outlet Deals',
  storeHost: 'voircheck-stores.onrender.com',
  productTitle: 'Zephlet Buds',
  amount: '23.00',
  currency: 'USD',
  verdict: 'BLOCK',
  score: 70,
  hardRules: [],
  signals: [
    { id: 'domain_age', status: 'pass', points: 0, summary: 'onrender.com was registered on 2015-03-28.' },
    { id: 'price', status: 'fail', points: 30, summary: '$23.00 here vs $60.50 typical at the other 2 stores.' },
    { id: 'ai_page', status: 'unavailable', points: 0, summary: 'AI analysis not yet enabled' },
    { id: 'clone', status: 'fail', points: 40, summary: 'vs Velbrook Supply: <b>copied</b> name & text.' },
  ],
  action: 'voided',
  actionAt: '2026-10-29T12:00:00.000Z',
  scannedAt: '2026-10-29T11:00:00.000Z',
  ...over,
});

const input = (over: Partial<Parameters<typeof deliverReceiptEmail>[0]> = {}) => ({
  receiptId: 'rcpt-1',
  slug: 'AbCdEfGhIjKlMnOpQrStUvWx',
  to: 'shopper@example.com',
  lang: 'en' as const,
  snapshot: snapshot(),
  baseUrl: 'https://voircheck-web.onrender.com',
  ...over,
});

function mocks(sendImpl?: ResendLike['emails']['send']) {
  let claimed = false;
  const send = vi.fn(sendImpl ?? (async () => ({ data: { id: 'msg_123' }, error: null })));
  const deps: MailerDeps & { auditLog: Array<[string, Record<string, unknown>]> } = {
    resend: { emails: { send } },
    from: DEFAULT_EMAIL_FROM,
    claim: vi.fn(async () => (claimed ? false : (claimed = true))),
    release: vi.fn(async () => {
      claimed = false;
    }),
    auditLog: [],
    audit: vi.fn(async (action, details) => {
      deps.auditLog.push([action, details]);
    }),
    log: vi.fn(),
  };
  return { deps, send };
}

beforeEach(() => resetNoKeyWarning());

describe('Trust Receipt email delivery', () => {
  it('sends once per receipt, even when triggered twice (webhook retry, second tab)', async () => {
    const { deps, send } = mocks();
    expect(await deliverReceiptEmail(input(), deps)).toBe('sent');
    expect(await deliverReceiptEmail(input(), deps)).toBe('duplicate');
    expect(send).toHaveBeenCalledTimes(1);
    const [payload, options] = send.mock.calls[0]!;
    expect(payload).toMatchObject({ from: 'VoirCheck <receipts@mail.voircheck.com>', to: ['shopper@example.com'] });
    expect(options).toEqual({ idempotencyKey: 'trust-receipt/rcpt-1' });
    expect(deps.auditLog).toEqual([['receipt.email_sent', { resendId: 'msg_123', lang: 'en', action: 'voided' }]]);
  });

  it('skips without RESEND_API_KEY and logs only once', async () => {
    const { deps } = mocks();
    const noKey = { ...deps, resend: null };
    expect(await deliverReceiptEmail(input(), noKey)).toBe('skipped_no_key');
    expect(await deliverReceiptEmail(input(), noKey)).toBe('skipped_no_key');
    expect(noKey.log).toHaveBeenCalledTimes(1);
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it('a Resend error or exception never throws; the claim is released and the failure audited', async () => {
    const errored = mocks(async () => ({ data: null, error: { message: 'domain not verified', name: 'validation_error' } }));
    await expect(deliverReceiptEmail(input(), errored.deps)).resolves.toBe('failed');
    expect(errored.deps.release).toHaveBeenCalled();
    expect(errored.deps.auditLog[0]).toEqual(['receipt.email_failed', { error: 'domain not verified', lang: 'en' }]);
    // Released, so a later trigger can retry and succeed.
    errored.send.mockImplementationOnce(async () => ({ data: { id: 'msg_retry' }, error: null }));
    expect(await deliverReceiptEmail(input(), errored.deps)).toBe('sent');

    const thrown = mocks(async () => {
      throw new Error('network down');
    });
    await expect(deliverReceiptEmail(input(), thrown.deps)).resolves.toBe('failed');

    const brokenAudit = mocks();
    brokenAudit.deps.audit = async () => {
      throw new Error('db down');
    };
    await expect(deliverReceiptEmail(input(), brokenAudit.deps)).resolves.toBe('failed');
  });

  it('uses the French template for French users', async () => {
    const { deps, send } = mocks();
    await deliverReceiptEmail(input({ lang: 'fr' }), deps);
    const [payload] = send.mock.calls[0]!;
    expect(payload.subject).toBe('Reçu de confiance : Velbrook-Outlet Deals, Arrêté (blocage levé)');
    expect(payload.html).toContain('<html lang="fr">');
    expect(payload.html).toContain('Voir le reçu complet');
    expect(payload.text).toContain('Pourquoi\u00a0:');
    expect(payload.text).toContain('Détection de copie');
  });

  it('only final outcomes are emailed; demo accounts (no real inbox) are skipped', async () => {
    const { deps, send } = mocks();
    expect(await deliverReceiptEmail(input({ snapshot: snapshot({ action: 'held', verdict: 'HOLD' }) }), deps)).toBe('not_final');
    expect(await deliverReceiptEmail(input({ snapshot: snapshot({ action: 'cancelled' }) }), deps)).toBe('not_final');
    expect(await deliverReceiptEmail(input({ to: 'guest-abc@guest.voircheck.invalid' }), deps)).toBe('skipped_guest');
    for (const action of ['captured', 'override', 'voided'] as const) {
      const m = mocks();
      expect(await deliverReceiptEmail(input({ snapshot: snapshot({ action }) }), m.deps)).toBe('sent');
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Trust Receipt email content', () => {
  it('has store, product, amount, verdict + score, top reasons, outcome and the receipt link', () => {
    const { subject, html, text } = buildReceiptEmail({ snapshot: snapshot(), slug: 'AbCdEfGhIjKlMnOpQrStUvWx', lang: 'en', baseUrl: 'https://voircheck-web.onrender.com/' });
    expect(subject).toBe('Trust Receipt: Velbrook-Outlet Deals, Stopped (hold released)');
    for (const part of ['Velbrook-Outlet Deals', 'Zephlet Buds', '$23.00', 'Block · Risk score 70/100', 'Stopped (hold released)', 'https://voircheck-web.onrender.com/r/AbCdEfGhIjKlMnOpQrStUvWx']) {
      expect(text).toContain(part);
    }
    expect(html).toContain('href="https://voircheck-web.onrender.com/r/AbCdEfGhIjKlMnOpQrStUvWx"');
    // Mono ink + verdict colors only.
    expect(html).toContain('background:#FFFFFF;color:#0C0C0C');
    expect(html).toContain('background:#FCEBEB;color:#791F1F');
  });

  it('top reasons: red flags first by points, at most 3, never "not checked"', () => {
    expect(topReasons(snapshot()).map((r) => r.id)).toEqual(['clone', 'price', 'domain_age']);
  });

  it('escapes text quoted from store pages', () => {
    const { html } = buildReceiptEmail({ snapshot: snapshot(), slug: 'AbCdEfGhIjKlMnOpQrStUvWx', lang: 'en', baseUrl: 'https://x.test' });
    expect(html).toContain('&lt;b&gt;copied&lt;/b&gt; name &amp; text.');
    expect(html).not.toContain('<b>copied</b>');
  });
});
