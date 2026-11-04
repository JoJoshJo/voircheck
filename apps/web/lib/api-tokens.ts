import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { apiTokens } from '@voircheck/db/schema';
import { ownedBy } from '@voircheck/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from './db';
import { isGuestEmail } from './guest';

/**
 * Per-user API tokens for AI agents over MCP (POST /api/mcp). The token is shown to the person once, when created;
 * only its SHA-256 is stored, so a database leak gives nobody a working token. A token acts as its owner only
 * (user-scoped, like the session) and can be revoked at any time. Tokens are never logged: nothing here or in the MCP
 * route prints a header, a token or a hash.
 */

export const TOKEN_PREFIX = 'vcmcp_';
/** 32 random bytes, base64url: 256 bits. */
const TOKEN_RE = /^vcmcp_[A-Za-z0-9_-]{43}$/;
export const MAX_ACTIVE_TOKENS = 5;
/** Shown in Settings to tell tokens apart; reveals 4 of the 43 random characters. */
export const PREFIX_SHOWN = TOKEN_PREFIX.length + 4;

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashApiToken(token), prefix: token.slice(0, PREFIX_SHOWN) };
}

export const hashApiToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** The token from `Authorization: Bearer <token>`, or null. Anything that isn't exactly our shape is null. */
export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^Bearer[ ]+(\S+)$/);
  return m && TOKEN_RE.test(m[1]!) ? m[1]! : null;
}

export interface TokenOwner {
  tokenId: string;
  userId: string;
  isGuest: boolean;
}

interface TokenRow {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

/** Pure part of authentication: a row for this hash that isn't revoked. Exported for tests. */
export async function ownerForToken(header: string | null, lookup: (hash: string) => Promise<TokenRow | null>): Promise<Omit<TokenOwner, 'isGuest'> | null> {
  const token = bearerToken(header);
  if (!token) return null;
  const row = await lookup(hashApiToken(token));
  if (!row || row.revokedAt) return null;
  return { tokenId: row.id, userId: row.userId };
}

const USED_WRITE_EVERY_MS = 5 * 60_000;

/**
 * The api_tokens table arrives with migration 0006. Until it's applied, tokens are simply unavailable: Settings says
 * so and /api/mcp answers 401, instead of either one failing.
 */
export function isMissingTokenTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const msg = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
  return code === '42P01' || /relation "api_tokens" does not exist/.test(msg);
}

/** The owner of a request's bearer token, or null (missing, malformed, unknown or revoked). */
export async function authenticateApiToken(header: string | null): Promise<TokenOwner | null> {
  try {
    return await authenticate(header);
  } catch (err) {
    if (isMissingTokenTable(err)) return null;
    throw err;
  }
}

async function authenticate(header: string | null): Promise<TokenOwner | null> {
  const db = getDb();
  const owner = await ownerForToken(header, async (hash) => {
    const [row] = await db.select({ id: apiTokens.id, userId: apiTokens.userId, revokedAt: apiTokens.revokedAt, lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(eq(apiTokens.tokenHash, hash)).limit(1);
    if (row && !row.revokedAt && (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > USED_WRITE_EVERY_MS)) {
      await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
    }
    return row ?? null;
  });
  if (!owner) return null;
  // Guest (demo) accounts get the guest limits, like in the app. Their email marks them; read it from Neon Auth.
  return { ...owner, isGuest: await isGuestUser(owner.userId) };
}

async function isGuestUser(userId: string): Promise<boolean> {
  const { rows } = await getDb().execute<{ email: string | null }>(sql`select email from neon_auth."user" where id = ${userId} limit 1`);
  return isGuestEmail(rows[0]?.email);
}

export interface TokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** This user's active tokens, or null while the token table isn't set up yet. */
export async function listApiTokens(userId: string): Promise<TokenView[] | null> {
  try {
    return await activeTokens(userId);
  } catch (err) {
    if (isMissingTokenTable(err)) return null;
    throw err;
  }
}

function activeTokens(userId: string): Promise<TokenView[]> {
  return getDb()
    .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens)
    .where(ownedBy(apiTokens, userId, isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

/** Creates a token for this user; returns it ONCE (never stored, never logged). */
export async function createApiToken(userId: string, name: string): Promise<{ token: string; view: TokenView } | 'limit' | 'unavailable'> {
  const active = await listApiTokens(userId);
  if (!active) return 'unavailable';
  if (active.length >= MAX_ACTIVE_TOKENS) return 'limit';
  const { token, hash, prefix } = generateApiToken();
  const [row] = await getDb()
    .insert(apiTokens)
    .values({ userId, name: name.trim().slice(0, 60) || 'AI agent', prefix, tokenHash: hash })
    .returning({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt });
  return { token, view: row! };
}

/** Revokes one of this user's tokens (owner-scoped: another user's token ID does nothing). */
export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  await getDb()
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(ownedBy(apiTokens, userId, and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt))));
}
