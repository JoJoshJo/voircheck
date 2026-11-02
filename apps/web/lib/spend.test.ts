import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({ row: undefined as { anthropicUsd: string; kernelScans: number } | undefined, inserted: [] as unknown[], conflictSet: [] as unknown[] }));
vi.mock('./db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (db.row ? [db.row] : []) }) }) }),
    insert: () => ({
      values: (v: unknown) => {
        db.inserted.push(v);
        return { onConflictDoUpdate: async (o: { set: unknown }) => void db.conflictSet.push(o.set) };
      },
    }),
  }),
}));

const { anthropicCapReached, DAILY_CAPS, kernelCapReached, recordSpend, spendToday, utcDay } = await import('./spend');

beforeEach(() => {
  db.row = undefined;
  db.inserted = [];
  db.conflictSet = [];
});

describe('global daily caps (all users, per UTC day)', () => {
  it('the day is the UTC date', () => {
    expect(utcDay(new Date('2026-11-04T23:30:00-05:00'))).toBe('2026-11-05');
  });
  it('nothing spent yet → zero, caps not reached', async () => {
    expect(await spendToday()).toEqual({ anthropicUsd: 0, kernelScans: 0 });
    expect(await anthropicCapReached()).toBe(false);
    expect(await kernelCapReached()).toBe(false);
  });
  it('caps are reached at the limit, not after it', async () => {
    db.row = { anthropicUsd: DAILY_CAPS.anthropicUsd.toFixed(6), kernelScans: DAILY_CAPS.kernelScans - 1 };
    expect(await anthropicCapReached()).toBe(true);
    expect(await kernelCapReached()).toBe(false);
    db.row = { anthropicUsd: '2.999999', kernelScans: DAILY_CAPS.kernelScans };
    expect(await anthropicCapReached()).toBe(false);
    expect(await kernelCapReached()).toBe(true);
  });
  it('stays under the $5 Anthropic workspace cap', () => {
    expect(DAILY_CAPS.anthropicUsd).toBeLessThan(5);
  });
  it('records by adding to today’s row in one upsert; nothing to add → no write', async () => {
    await recordSpend({ anthropicUsd: 0.0215, kernelScans: 1 }, new Date('2026-11-04T12:00:00Z'));
    expect(db.inserted).toEqual([{ day: '2026-11-04', anthropicUsd: '0.021500', kernelScans: 1 }]);
    expect(db.conflictSet).toHaveLength(1);
    await recordSpend({ anthropicUsd: 0 });
    expect(db.inserted).toHaveLength(1);
  });
});
