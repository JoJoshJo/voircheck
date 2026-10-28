export const dynamic = 'force-dynamic';

/** Render health check: the process is up. Deliberately touches no database or third party. */
export function GET() {
  return Response.json({ ok: true });
}
