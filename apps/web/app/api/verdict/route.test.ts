import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
type Row = { verdict: 'SAFE' | 'HOLD' | 'BLOCK'; scannedAt: Date };
const db = { rows: [] as Row[], selected: [] as string[][], whereArgs: [] as unknown[], fail: false };
vi.mock('../../../lib/db', () => ({
  getDb: () => {
    if (db.fail) throw new Error('db down');
    return {
      select: (cols: Record<string, unknown>) => {
        db.selected.push(Object.keys(cols));
        const q = { from: () => q, where: (w: unknown) => (db.whereArgs.push(w), q), orderBy: () => q, limit: async () => db.rows };
        return q;
      },
    };
  },
}));

const { GET } = await import('./route');
const { normalizeDomain, isSharedDemoHost, toSavedVerdict, SAVED_VERDICT_READS_PER_IP_PER_HOUR } = await import('../../../lib/saved-verdict');

let ip = 0;
async function ask(domain: string | null, from = `10.0.0.${++ip}`) {
  const u = new URL('https://voircheck.com/api/verdict');
  if (domain !== null) u.searchParams.set('domain', domain);
  const res = await GET(new NextRequest(u, { headers: { 'cf-connecting-ip': from } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, res };
}

beforeEach(() => {
  db.rows = [];
  db.selected = [];
  db.whereArgs = [];
  db.fail = false;
});

describe('normalizeDomain', () => {
  it('keeps plain host names, lowercased, without www. or a trailing dot', () => {
    expect(normalizeDomain('Amazon.com')).toBe('amazon.com');
    expect(normalizeDomain('www.amazon.com.')).toBe('amazon.com');
    expect(normalizeDomain('outlet.shop.example')).toBe('outlet.shop.example');
    expect(normalizeDomain('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
  });
  it.each(['', 'https://amazon.com', 'amazon.com/p/1', 'amazon', '127.0.0.1', 'a b.com', 'user@amazon.com', '-x.com', `${'a'.repeat(250)}.com`, null])('rejects %s', (raw) => {
    expect(normalizeDomain(raw)).toBeNull();
  });
});

describe('the shared demo host', () => {
  it('is never answered for, since safe and fake demo stores share it', async () => {
    expect(isSharedDemoHost('voircheck-stores.onrender.com')).toBe(true);
    expect(isSharedDemoHost('amazon.com')).toBe(false);
    db.rows = [{ verdict: 'BLOCK', scannedAt: new Date() }];
    const { body } = await ask('voircheck-stores.onrender.com');
    expect(body).toEqual({ status: 'not_checked' });
    expect(db.selected).toEqual([]); // not even looked up
  });
});

describe('GET /api/verdict', () => {
  it('answers only the verdict, a hedged line and the date', async () => {
    const at = new Date('2026-11-10T09:00:00Z');
    db.rows = [{ verdict: 'BLOCK', scannedAt: at }];
    const { status, body, res } = await ask('www.velbrook.example');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['checkedAt', 'message', 'status', 'verdict']);
    expect(body).toMatchObject({ status: 'checked', verdict: 'BLOCK', checkedAt: at.toISOString() });
    expect((body.message as { en: string }).en).toMatch(/when VoirCheck checked it/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Reads two columns, never url, signals or anything else.
    expect(db.selected).toEqual([['verdict', 'scannedAt']]);
  });

  it('no saved result in the last 72 hours → not checked', async () => {
    const { status, body } = await ask('amazon.com');
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'not_checked' });
  });

  it('every verdict has a hedged line in EN and FR', () => {
    for (const v of ['SAFE', 'HOLD', 'BLOCK'] as const) {
      const out = toSavedVerdict({ verdict: v, scannedAt: new Date() });
      expect(out.status).toBe('checked');
      if (out.status !== 'checked') continue;
      expect(out.message.en).toMatch(/when VoirCheck checked it/);
      expect(out.message.fr).toMatch(/lors de notre vérification/);
    }
  });

  it('rejects anything but a domain', async () => {
    for (const bad of ['https://amazon.com/p/1', 'amazon', null]) expect((await ask(bad)).status).toBe(400);
  });

  it('is rate-limited per IP', async () => {
    for (let i = 0; i < SAVED_VERDICT_READS_PER_IP_PER_HOUR; i++) expect((await ask('amazon.com', '10.9.9.9')).status).toBe(200);
    expect((await ask('amazon.com', '10.9.9.9')).status).toBe(429);
    expect((await ask('amazon.com', '10.9.9.10')).status).toBe(200);
  });

  it('a database failure is a plain 503, never a crash', async () => {
    db.fail = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await ask('amazon.com')).status).toBe(503);
    spy.mockRestore();
  });
});
