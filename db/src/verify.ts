import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

config({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });

// Prints table names and counts only — never connection details.
const sql = neon(process.env.DATABASE_URL_UNPOOLED!);
const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
console.log(`public tables (${tables.length}): ${tables.map((t) => t.table_name).join(', ')}`);
const [{ n }] = (await sql`select count(*)::int as n from demo_stores`) as [{ n: number }];
console.log(`demo_stores count: ${n}`);
const triggers = await sql`select tgname from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal`;
console.log(`audit_log triggers: ${triggers.map((t) => t.tgname).join(', ') || 'none'}`);
