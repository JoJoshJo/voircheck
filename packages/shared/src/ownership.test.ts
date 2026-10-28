import { PgDialect, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { ownedBy } from './ownership';

const things = pgTable('things', { id: uuid('id'), userId: uuid('user_id'), status: text('status') });
const dialect = new PgDialect();

describe('ownedBy', () => {
  it('filters by the owner', () => {
    const { sql, params } = dialect.sqlToQuery(ownedBy(things, 'u-1'));
    expect(sql).toContain('"user_id" = $1');
    expect(params).toEqual(['u-1']);
  });

  it('refuses an empty user id', () => {
    expect(() => ownedBy(things, '')).toThrow(/missing user id/);
  });
});
