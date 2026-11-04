import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { headers } from 'next/headers';
import { authenticateApiToken } from '../../../lib/api-tokens';
import { publicOrigin } from '../../../lib/app-origin';
import { clientIp } from '../../../lib/client-ip';
import { mcpApi } from '../../../lib/mcp/api';
import { createMcpServer } from '../../../lib/mcp/core';
import { singleMessageRequest } from '../../../lib/mcp/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// check_store may run a full scan (same budget as the scan route).
export const maxDuration = 120;

const unauthorized = () =>
  Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message: 'Missing, invalid or revoked VoirCheck API token. Create one in Settings → Connect an AI agent.' }, id: null },
    { status: 401, headers: { 'www-authenticate': 'Bearer realm="voircheck"', 'cache-control': 'no-store' } },
  );

const guestRefused = () =>
  Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message: 'Guest demo accounts cannot use the MCP server. Sign up to connect an AI agent.' }, id: null },
    { status: 403, headers: { 'cache-control': 'no-store' } },
  );

/**
 * VoirCheck's MCP server (Streamable HTTP, stateless, JSON responses). Auth: a per-user API token as a Bearer header,
 * never a cookie, so a browser can't be made to call it with someone's session. The token is hashed and looked up;
 * neither the token nor any header is ever logged. Every request gets a fresh server bound to the token's owner.
 * One JSON-RPC message per request: batches are refused (400) before the SDK sees them.
 */
export async function POST(req: Request) {
  const owner = await authenticateApiToken(req.headers.get('authorization'));
  if (!owner) return unauthorized();
  // Guest accounts can't create tokens; a token from before that rule is refused here too.
  if (owner.isGuest) return guestRefused();
  const single = await singleMessageRequest(req);
  if (single instanceof Response) return single;
  const h = await headers();
  const server = createMcpServer(mcpApi(owner, { ip: clientIp(h), origin: publicOrigin(h) }));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(single);
  res.headers.set('cache-control', 'no-store');
  return res;
}

/** Stateless server: no server-to-client stream and no sessions to end. */
const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
