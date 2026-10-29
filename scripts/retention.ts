/**
 * Data retention job (spec 5.9, Privacy page).
 *   pnpm retention:run              → dry run (default): counts what would be deleted, changes nothing
 *   pnpm retention:run --apply      → deletes, in one transaction; refused before 2026-12-15
 * Keeps shared scans, the append-only audit_log, webhook_events and public receipts (payment link cleared).
 * After an apply it appends one anonymous audit_log row with the counts.
 */
import 'dotenv/config';
import { createDb } from '@voircheck/db';
import { RETENTION_STEPS, retentionPolicy } from '@voircheck/db/retention';

const apply = process.argv.includes('--apply');
const now = new Date();
const policy = retentionPolicy(now);
const db = createDb(process.env.DATABASE_URL);
const sql = db.$client;

console.log(`Retention cutoff: ${policy.cutoff.toISOString()} (rows created before this are in scope)`);
const counts: Record<string, number> = {};
for (const step of RETENTION_STEPS) {
  const [row] = (await sql.query(step.countSql, [policy.cutoff.toISOString()])) as Array<{ n: number }>;
  const key = `${step.action} ${step.table}`;
  counts[key] = (counts[key] ?? 0) + (row?.n ?? 0);
  console.log(`  ${step.action.padEnd(6)} ${step.table.padEnd(22)} ${String(row?.n ?? 0).padStart(5)}  ${step.description}`);
}
console.log('  kept    scans, audit_log, webhook_events, test_set_results, demo_stores');

if (!apply) {
  console.log(`\nDry run: nothing changed.${policy.canApply ? ' Re-run with --apply to delete.' : ` (${policy.message})`}`);
  process.exit(0);
}
if (!policy.canApply) {
  console.error(`\n${policy.message}`);
  process.exit(1);
}

console.log(`\n${policy.message}`);
await sql.transaction(RETENTION_STEPS.map((s) => sql.query(s.applySql, [policy.cutoff.toISOString()])));
await sql.query(`insert into audit_log (user_id, actor, action, entity, entity_id, details) values (null, 'system', 'retention.run', 'retention', null, $1::jsonb)`, [
  JSON.stringify({ cutoff: policy.cutoff.toISOString(), counts }),
]);
console.log('Done. Counts recorded in audit_log (retention.run).');
