import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDb } from './client';
import { DEMO_STORES } from './demo-stores';
import { demoStores } from './schema';

config({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });

// Idempotent: re-running updates names/pair/role/theme but never overwrites a domain set later.
const db = createDb(process.env.DATABASE_URL_UNPOOLED);
const rows = await db
  .insert(demoStores)
  .values(DEMO_STORES)
  .onConflictDoUpdate({
    target: demoStores.slug,
    set: { name: sql`excluded.name`, pair: sql`excluded.pair`, role: sql`excluded.role`, theme: sql`excluded.theme` },
  })
  .returning({ slug: demoStores.slug });
console.log(`seeded demo_stores: ${rows.length} rows`);
