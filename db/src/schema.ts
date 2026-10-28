/**
 * VoirCheck data model (spec 5.9). Neon Postgres, Drizzle ORM.
 *
 * Users live in Neon's managed Better Auth schema (`neon_auth.user`, id uuid). We never
 * create our own users table; user-owned tables reference neon_auth.user(id).
 * Money: no raw payment details anywhere; PayPal holds them. Payments go to the app's
 * own merchant account, so a payment stores `store_slug` (sent as PayPal custom_id), not a payee.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Managed by Neon Auth. Declared only so foreign keys can point at it; not exported, so
// drizzle-kit never creates or alters it.
const neonAuth = pgSchema('neon_auth');
const authUser = neonAuth.table('user', { id: uuid('id').primaryKey() });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ownerId = () => uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' });

export const storeRole = pgEnum('store_role', ['legit', 'scam', 'borderline']);
export const entryType = pgEnum('entry_type', ['chat', 'link']);
export const candidateSource = pgEnum('candidate_source', ['channel3', 'demo', 'link']);
export const verdict = pgEnum('verdict', ['SAFE', 'HOLD', 'BLOCK']);
export const paymentMode = pgEnum('payment_mode', ['approve', 'auto']);
export const auditActor = pgEnum('audit_actor', ['user', 'agent', 'system', 'webhook']);
export const trueLabel = pgEnum('true_label', ['scam', 'legit']);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey().references(() => authUser.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  language: text('language').notNull().default('en'),
  autopayEnabled: boolean('autopay_enabled').notNull().default(false),
  autopayLimit: numeric('autopay_limit', { precision: 10, scale: 2 }),
  createdAt: createdAt(),
});

export const demoStores = pgTable(
  'demo_stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    domain: text('domain'), // set once domains are bought (~Nov 3–5)
    pair: smallint('pair').notNull(),
    role: storeRole('role').notNull(),
    theme: text('theme').notNull(), // key into the stores app's theme config
  },
  (t) => [check('demo_stores_pair_range', sql`${t.pair} between 1 and 3`)],
);

export const shoppingSessions = pgTable(
  'shopping_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: ownerId(),
    entryType: entryType('entry_type').notNull(),
    queryOrUrl: text('query_or_url').notNull(),
    demoMode: boolean('demo_mode').notNull().default(true),
    status: text('status').notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('shopping_sessions_user_idx').on(t.userId, t.createdAt)],
);

export const candidates = pgTable(
  'candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => shoppingSessions.id, { onDelete: 'cascade' }),
    storeName: text('store_name').notNull(),
    storeUrl: text('store_url').notNull(),
    productTitle: text('product_title').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    source: candidateSource('source').notNull(),
    rank: integer('rank'),
  },
  (t) => [index('candidates_session_idx').on(t.sessionId)],
);

export const scans = pgTable(
  'scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeDomain: text('store_domain').notNull(),
    url: text('url').notNull(),
    riskScore: smallint('risk_score').notNull(),
    verdict: verdict('verdict').notNull(),
    signals: jsonb('signals').notNull(), // all six signal results + evidence
    explanation: jsonb('explanation').notNull(), // per language
    hardRulesTriggered: text('hard_rules_triggered').array().notNull().default(sql`'{}'::text[]`),
    kernelReplayUrl: text('kernel_replay_url'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
    cacheExpiresAt: timestamp('cache_expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (t) => [
    check('scans_risk_score_range', sql`${t.riskScore} between 0 and 100`),
    index('scans_domain_cache_idx').on(t.storeDomain, t.cacheExpiresAt),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => shoppingSessions.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id),
    scanId: uuid('scan_id').references(() => scans.id),
    paypalOrderId: text('paypal_order_id').notNull().unique(),
    authorizationId: text('authorization_id'),
    captureId: text('capture_id'),
    storeSlug: text('store_slug').notNull(), // sent to PayPal as purchase_units[0].custom_id
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    status: text('status').notNull(),
    mode: paymentMode('mode').notNull(),
    overrideUsed: boolean('override_used').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('payments_session_idx').on(t.sessionId)],
);

export const trustReceipts = pgTable(
  'trust_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicSlug: text('public_slug').notNull().unique(), // unguessable; receipts hold no personal info
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id').references(() => scans.id, { onDelete: 'cascade' }),
    language: text('language').notNull().default('en'),
    snapshot: jsonb('snapshot').notNull(),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check('trust_receipts_has_subject', sql`${t.paymentId} is not null or ${t.scanId} is not null`)],
);

// Append-only: an UPDATE/DELETE-rejecting trigger is added in the custom migration.
// user_id has no foreign key on purpose, so audit history survives user deletion.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id'),
    actor: auditActor('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_user_idx').on(t.userId, t.createdAt), index('audit_log_entity_idx').on(t.entity, t.entityId)],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paypalEventId: text('paypal_event_id').notNull(),
    eventType: text('event_type').notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('webhook_events_paypal_event_id_key').on(t.paypalEventId)], // idempotency
);

// Token ID only, never card/account details.
export const vaultTokens = pgTable('vault_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: ownerId(),
  paypalVaultTokenId: text('paypal_vault_token_id').notNull().unique(),
  status: text('status').notNull(),
  createdAt: createdAt(),
});

export const testSetResults = pgTable('test_set_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  trueLabel: trueLabel('true_label').notNull(),
  source: text('source'),
  verdict: verdict('verdict').notNull(),
  riskScore: smallint('risk_score').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
});
