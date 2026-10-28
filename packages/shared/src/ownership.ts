import { and, eq, type Column, type SQL } from 'drizzle-orm';

/**
 * Owner filter for user-owned tables (spec 5.10 / 5.17): every server query on a table
 * with a `userId` column must go through this, so a user only ever reads or changes
 * their own rows.
 *
 *   db.select().from(shoppingSessions).where(ownedBy(shoppingSessions, user.id))
 *   db.update(profiles).set({ ... }).where(ownedBy(profiles, user.id))
 *
 * Child tables without their own user_id (candidates, payments) are owned through
 * shopping_sessions: join to it and filter with ownedBy(shoppingSessions, userId).
 *
 * Postgres RLS could be layered on later as a second line of defense: enable RLS on
 * profiles / shopping_sessions / candidates / payments / vault_tokens with policies on
 * `user_id = current_setting('app.user_id')::uuid` (set per transaction). Until then
 * this helper is the only owner check, so never query those tables without it.
 */
export function ownedBy(table: { userId: Column }, userId: string, ...extra: (SQL | undefined)[]): SQL {
  if (!userId) throw new Error('ownedBy: missing user id (refusing an unscoped query)');
  return and(eq(table.userId, userId), ...extra)!;
}
