/**
 * Data retention (spec 5.9 + Privacy page): keep everything through judging (until 2026-12-15); after that, delete
 * user-linked data 90 days after it was created. Kept: shared `scans`, the append-only `audit_log` (random user id
 * only, no name/email), `webhook_events` (payment status only), `test_set_results`, `demo_stores`, and public Trust
 * Receipts (their link to the deleted payment is cleared first so the public page keeps working).
 *
 * A row is deleted when it is older than the cutoff, or when it belongs to an account older than the cutoff.
 * Statement order follows the foreign keys (payments → candidates is NO ACTION; receipts → payments is CASCADE).
 */

export const RETENTION_STARTS = new Date('2026-12-15T00:00:00Z');
export const RETENTION_DAYS = 90;
const DAY = 86_400_000;

export type RetentionPolicy =
  | { canApply: true; cutoff: Date; message: string }
  | { canApply: false; cutoff: Date; message: string };

export function retentionPolicy(now: Date): RetentionPolicy {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY);
  if (now.getTime() < RETENTION_STARTS.getTime()) {
    return {
      canApply: false,
      cutoff,
      message: `Refusing to delete: the retention job only runs after the judging period ends (${RETENTION_STARTS.toISOString().slice(0, 10)}). Today is ${now.toISOString().slice(0, 10)}. Dry runs are fine.`,
    };
  }
  return { canApply: true, cutoff, message: `Deleting user-linked data created before ${cutoff.toISOString()} (${RETENTION_DAYS} days ago).` };
}

/** Accounts older than the cutoff ($1). */
const EXPIRED_USERS = `select id from neon_auth."user" where "createdAt" < $1`;
/** Shopping sessions that go: old ones, and every session of an expired account. */
const EXPIRED_SESSIONS = `select id from shopping_sessions where created_at < $1 or user_id in (${EXPIRED_USERS})`;
const EXPIRED_PAYMENTS = `select id from payments where session_id in (${EXPIRED_SESSIONS})`;

export interface RetentionStep {
  table: string;
  action: 'delete' | 'unlink';
  description: string;
  /** Rows this step will touch; `$1` is the cutoff. */
  countSql: string;
  /** The change itself; `$1` is the cutoff. */
  applySql: string;
}

/** In foreign-key order. Never lists audit_log, scans, webhook_events, test_set_results or demo_stores. */
export const RETENTION_STEPS: readonly RetentionStep[] = [
  {
    table: 'trust_receipts',
    action: 'unlink',
    description: 'clear the payment link of public receipts (the receipt itself has no personal info and stays)',
    countSql: `select count(*)::int as n from trust_receipts where payment_id in (${EXPIRED_PAYMENTS}) and scan_id is not null`,
    applySql: `update trust_receipts set payment_id = null where payment_id in (${EXPIRED_PAYMENTS}) and scan_id is not null`,
  },
  {
    table: 'trust_receipts',
    action: 'delete',
    description: 'receipts that only pointed at a deleted payment (no scan to keep them meaningful)',
    countSql: `select count(*)::int as n from trust_receipts where payment_id in (${EXPIRED_PAYMENTS}) and scan_id is null`,
    applySql: `delete from trust_receipts where payment_id in (${EXPIRED_PAYMENTS}) and scan_id is null`,
  },
  {
    table: 'payments',
    action: 'delete',
    description: 'sandbox payments of expired shopping sessions',
    countSql: `select count(*)::int as n from payments where session_id in (${EXPIRED_SESSIONS})`,
    applySql: `delete from payments where session_id in (${EXPIRED_SESSIONS})`,
  },
  {
    table: 'candidates',
    action: 'delete',
    description: 'stores/prices of expired shopping sessions',
    countSql: `select count(*)::int as n from candidates where session_id in (${EXPIRED_SESSIONS})`,
    applySql: `delete from candidates where session_id in (${EXPIRED_SESSIONS})`,
  },
  {
    table: 'shopping_sessions',
    action: 'delete',
    description: 'requests and checked links older than the cutoff, or of expired accounts',
    countSql: `select count(*)::int as n from shopping_sessions where created_at < $1 or user_id in (${EXPIRED_USERS})`,
    applySql: `delete from shopping_sessions where created_at < $1 or user_id in (${EXPIRED_USERS})`,
  },
  {
    table: 'vault_tokens',
    action: 'delete',
    description: 'saved sandbox wallet references older than the cutoff, or of expired accounts',
    countSql: `select count(*)::int as n from vault_tokens where created_at < $1 or user_id in (${EXPIRED_USERS})`,
    applySql: `delete from vault_tokens where created_at < $1 or user_id in (${EXPIRED_USERS})`,
  },
  {
    table: 'profiles',
    action: 'delete',
    description: 'settings of expired accounts',
    countSql: `select count(*)::int as n from profiles where user_id in (${EXPIRED_USERS})`,
    applySql: `delete from profiles where user_id in (${EXPIRED_USERS})`,
  },
  {
    table: 'neon_auth.session',
    action: 'delete',
    description: 'sign-in sessions (IP address, user agent) older than the cutoff, or of expired accounts',
    countSql: `select count(*)::int as n from neon_auth.session where "createdAt" < $1 or "userId" in (${EXPIRED_USERS})`,
    applySql: `delete from neon_auth.session where "createdAt" < $1 or "userId" in (${EXPIRED_USERS})`,
  },
  {
    table: 'neon_auth.verification',
    action: 'delete',
    description: 'old sign-in link / verification records',
    countSql: `select count(*)::int as n from neon_auth.verification where "createdAt" < $1`,
    applySql: `delete from neon_auth.verification where "createdAt" < $1`,
  },
  {
    table: 'neon_auth.account',
    action: 'delete',
    description: 'sign-in methods (password hash, Google tokens) of expired accounts',
    countSql: `select count(*)::int as n from neon_auth.account where "userId" in (${EXPIRED_USERS})`,
    applySql: `delete from neon_auth.account where "userId" in (${EXPIRED_USERS})`,
  },
  {
    table: 'neon_auth.user',
    action: 'delete',
    description: 'accounts (name, email, picture) older than the cutoff',
    countSql: `select count(*)::int as n from neon_auth."user" where "createdAt" < $1`,
    applySql: `delete from neon_auth."user" where "createdAt" < $1`,
  },
];

// ---------- in-memory model of the same rules (tests, and documentation of intent) ----------

export interface RetentionSnapshot {
  users: Array<{ id: string; createdAt: Date }>;
  shoppingSessions: Array<{ id: string; userId: string; createdAt: Date }>;
  payments: Array<{ id: string; sessionId: string }>;
  candidates: Array<{ id: string; sessionId: string }>;
  vaultTokens: Array<{ id: string; userId: string; createdAt: Date }>;
  profiles: Array<{ userId: string }>;
  authSessions: Array<{ id: string; userId: string; createdAt: Date }>;
  receipts: Array<{ id: string; paymentId: string | null; scanId: string | null }>;
  scans: Array<{ id: string }>;
  auditLog: Array<{ id: number; userId: string | null }>;
}

/** What the SQL steps select, over in-memory rows. */
export function selectForRetention(db: RetentionSnapshot, cutoff: Date) {
  const old = (d: Date) => d.getTime() < cutoff.getTime();
  const expiredUsers = new Set(db.users.filter((u) => old(u.createdAt)).map((u) => u.id));
  const expiredSessions = new Set(db.shoppingSessions.filter((s) => old(s.createdAt) || expiredUsers.has(s.userId)).map((s) => s.id));
  const expiredPayments = new Set(db.payments.filter((p) => expiredSessions.has(p.sessionId)).map((p) => p.id));
  return {
    users: [...expiredUsers],
    shoppingSessions: [...expiredSessions],
    payments: [...expiredPayments],
    candidates: db.candidates.filter((c) => expiredSessions.has(c.sessionId)).map((c) => c.id),
    vaultTokens: db.vaultTokens.filter((v) => old(v.createdAt) || expiredUsers.has(v.userId)).map((v) => v.id),
    profiles: db.profiles.filter((p) => expiredUsers.has(p.userId)).map((p) => p.userId),
    authSessions: db.authSessions.filter((s) => old(s.createdAt) || expiredUsers.has(s.userId)).map((s) => s.id),
    receiptsUnlinked: db.receipts.filter((r) => r.paymentId && expiredPayments.has(r.paymentId) && r.scanId).map((r) => r.id),
    receiptsDeleted: db.receipts.filter((r) => r.paymentId && expiredPayments.has(r.paymentId) && !r.scanId).map((r) => r.id),
  };
}
