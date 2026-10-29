import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS, RETENTION_STEPS, retentionPolicy, selectForRetention, type RetentionSnapshot } from './retention';

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe('retention date gate (fake clock)', () => {
  it.each(['2026-10-29T12:00:00Z', '2026-12-14T23:59:59Z'])('refuses --apply before 2026-12-15 (%s)', (now) => {
    const p = retentionPolicy(at(now));
    expect(p.canApply).toBe(false);
    expect(p.message).toContain('only runs after the judging period ends (2026-12-15)');
  });

  it.each(['2026-12-15T00:00:00Z', '2027-03-01T08:00:00Z'])('allows it from 2026-12-15 (%s), cutoff = now - 90 days', (now) => {
    const p = retentionPolicy(at(now));
    expect(p.canApply).toBe(true);
    expect(p.cutoff.getTime()).toBe(at(now).getTime() - RETENTION_DAYS * DAY);
  });
});

describe('what gets selected', () => {
  const now = at('2027-03-01T00:00:00Z');
  const { cutoff } = retentionPolicy(now); // 2026-12-01
  const OLD = at('2026-11-01T00:00:00Z');
  const NEW = at('2027-02-01T00:00:00Z');
  const db: RetentionSnapshot = {
    users: [
      { id: 'u-old', createdAt: OLD },
      { id: 'u-new', createdAt: NEW },
    ],
    shoppingSessions: [
      { id: 's-old-of-new-user', userId: 'u-new', createdAt: OLD }, // impossible in practice, but old rows of a kept account still go
      { id: 's-new-of-old-user', userId: 'u-old', createdAt: NEW }, // account expires → all its sessions go
      { id: 's-new', userId: 'u-new', createdAt: NEW },
    ],
    payments: [
      { id: 'p-a', sessionId: 's-old-of-new-user' },
      { id: 'p-b', sessionId: 's-new-of-old-user' },
      { id: 'p-keep', sessionId: 's-new' },
    ],
    candidates: [
      { id: 'c-a', sessionId: 's-old-of-new-user' },
      { id: 'c-keep', sessionId: 's-new' },
    ],
    vaultTokens: [
      { id: 'v-old', userId: 'u-new', createdAt: OLD },
      { id: 'v-keep', userId: 'u-new', createdAt: NEW },
    ],
    profiles: [{ userId: 'u-old' }, { userId: 'u-new' }],
    authSessions: [
      { id: 'as-old', userId: 'u-new', createdAt: OLD },
      { id: 'as-keep', userId: 'u-new', createdAt: NEW },
      { id: 'as-of-old-user', userId: 'u-old', createdAt: NEW },
    ],
    receipts: [
      { id: 'r-public', paymentId: 'p-a', scanId: 'scan-1' },
      { id: 'r-orphan', paymentId: 'p-b', scanId: null },
      { id: 'r-keep', paymentId: 'p-keep', scanId: 'scan-1' },
    ],
    scans: [{ id: 'scan-1' }],
    auditLog: [{ id: 1, userId: 'u-old' }],
  };
  const s = selectForRetention(db, cutoff);

  it('only data older than 90 days, or belonging to an account older than 90 days', () => {
    expect(s.users).toEqual(['u-old']);
    expect(s.shoppingSessions.sort()).toEqual(['s-new-of-old-user', 's-old-of-new-user']);
    expect(s.payments.sort()).toEqual(['p-a', 'p-b']);
    expect(s.candidates).toEqual(['c-a']);
    expect(s.vaultTokens).toEqual(['v-old']);
    expect(s.profiles).toEqual(['u-old']);
    expect(s.authSessions.sort()).toEqual(['as-of-old-user', 'as-old']);
  });

  it('public receipts survive (payment link cleared); a receipt with nothing else to show is removed', () => {
    expect(s.receiptsUnlinked).toEqual(['r-public']);
    expect(s.receiptsDeleted).toEqual(['r-orphan']);
  });

  it('never selects scans or audit_log rows', () => {
    expect(Object.keys(s)).not.toContain('scans');
    expect(Object.keys(s)).not.toContain('auditLog');
  });
});

describe('the SQL plan', () => {
  const all = RETENTION_STEPS.map((s) => `${s.countSql}\n${s.applySql}`).join('\n');

  it('never touches audit_log, scans, webhook_events, test_set_results or demo_stores', () => {
    for (const s of RETENTION_STEPS) {
      for (const kept of ['audit_log', 'scans', 'webhook_events', 'test_set_results', 'demo_stores']) {
        expect(s.applySql).not.toMatch(new RegExp(`(delete from|update)\\s+${kept}\\b`));
        expect(s.table).not.toBe(kept);
      }
    }
    expect(all).not.toMatch(/delete from (audit_log|scans)/);
  });

  it('respects foreign-key order and uses the cutoff parameter', () => {
    const order = RETENTION_STEPS.map((s) => `${s.action}:${s.table}`);
    const idx = (k: string) => order.indexOf(k);
    expect(idx('unlink:trust_receipts')).toBeLessThan(idx('delete:payments')); // receipts → payments is CASCADE
    expect(idx('delete:payments')).toBeLessThan(idx('delete:candidates')); // payments → candidates is NO ACTION
    expect(idx('delete:candidates')).toBeLessThan(idx('delete:shopping_sessions'));
    expect(idx('delete:neon_auth.account')).toBeLessThan(idx('delete:neon_auth.user'));
    expect(order.at(-1)).toBe('delete:neon_auth.user');
    for (const s of RETENTION_STEPS) {
      expect(s.applySql).toContain('$1');
      expect(s.countSql).toMatch(/^select count\(\*\)/);
    }
  });
});
