/**
 * One-off: redact payer PII from webhook_events rows stored before Oct 29 (same whitelist as live webhooks).
 *   pnpm webhooks:redact            → dry run (default): counts only, changes nothing
 *   pnpm webhooks:redact --apply    → rewrites the changed rows
 * Prints counts and PII key names only, never values.
 */
import 'dotenv/config';
import { createDb } from '@voircheck/db';
import { webhookEvents } from '@voircheck/db/schema';
import { piiKeysPresent, redactWebhookPayload } from '@voircheck/paypal';
import { eq } from 'drizzle-orm';

const apply = process.argv.includes('--apply');

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const db = createDb(process.env.DATABASE_URL);

const rows = await db.select({ id: webhookEvents.id, eventType: webhookEvents.eventType, payload: webhookEvents.payload }).from(webhookEvents);
const changed = rows
  .map((r) => ({ ...r, redacted: redactWebhookPayload(r.payload), pii: piiKeysPresent(r.payload) }))
  // Compare ignoring key order: Postgres jsonb stores keys in its own order.
  .filter((r) => canonical(r.redacted) !== canonical(r.payload));

const byType = new Map<string, number>();
const keys = new Set<string>();
for (const r of changed) {
  byType.set(r.eventType, (byType.get(r.eventType) ?? 0) + 1);
  r.pii.forEach((k) => keys.add(k));
}
const withPii = changed.filter((r) => r.pii.size > 0).length;

console.log(`webhook_events rows: ${rows.length}`);
console.log(`rows that would change: ${changed.length} (of which with payer/PII keys: ${withPii})`);
console.log(`by event type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(', ') || 'none'}`);
console.log(`PII keys found (names only): ${[...keys].sort().join(', ') || 'none'}`);

if (!apply) {
  console.log('\nDry run: nothing changed. Re-run with --apply to rewrite these rows.');
} else {
  let done = 0;
  for (const r of changed) {
    await db.update(webhookEvents).set({ payload: r.redacted }).where(eq(webhookEvents.id, r.id));
    done++;
  }
  const after = await db.select({ payload: webhookEvents.payload }).from(webhookEvents);
  const left = after.filter((r) => piiKeysPresent(r.payload).size > 0).length;
  console.log(`\nApplied: ${done} rows rewritten. Rows still containing PII keys: ${left}.`);
}
