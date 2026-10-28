import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '../.env', quiet: true });

// Migrations use the unpooled connection (spec 5.10); app queries use DATABASE_URL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  schemaFilter: ['public'], // neon_auth is managed by Neon Auth
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
  strict: true,
});
