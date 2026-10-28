import 'server-only';
import { createDb, type Db } from '@voircheck/db';

let db: Db | null = null;

/** One Drizzle client per server process (Neon serverless HTTP driver, pooled DATABASE_URL). */
export function getDb(): Db {
  db ??= createDb(process.env.DATABASE_URL);
  return db;
}
