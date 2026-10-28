import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/** App-query client over Neon's serverless HTTP driver (pooled DATABASE_URL). */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle({ client: neon(url), schema });
}

export type Db = ReturnType<typeof createDb>;
