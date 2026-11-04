import { maybeRefreshDemoScans } from '../../../lib/demo-refresh';

export const dynamic = 'force-dynamic';

/**
 * Render health check (and the keep-warm ping): the process is up. The answer touches no database or third party.
 * It may also start, in the background, the hourly demo-scan refresh (lib/demo-refresh.ts); the response never waits.
 */
export function GET() {
  maybeRefreshDemoScans();
  return Response.json({ ok: true });
}
