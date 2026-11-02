import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './lib/security-headers';

// Local dev: secrets live in the repo-root .env (gitignored). On Render they come from the dashboard and this is a no-op.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ['@voircheck/shared', '@voircheck/db', '@voircheck/scanner', '@voircheck/agent', '@voircheck/paypal'],
  // Server-only SDKs with Node built-ins; keep them out of the bundler.
  serverExternalPackages: ['@onkernel/sdk', '@neondatabase/serverless'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV !== 'production') }];
  },
};

export default nextConfig;
