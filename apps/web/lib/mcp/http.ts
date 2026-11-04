/**
 * Request checks for POST /api/mcp that run before the MCP SDK sees the body (security review, H1).
 * One JSON-RPC message per request: a batch (a JSON array) is refused with 400, so one request can never start
 * several scans at once. Bodies are capped well under the SDK's own 4 MB limit: the three tools take a URL, an ID
 * and an amount.
 */
export const MAX_MCP_BODY_BYTES = 64 * 1024;

const rpcError = (status: number, code: number, message: string) =>
  Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status, headers: { 'cache-control': 'no-store' } });

/** The request to hand to the MCP transport, or the refusal to send instead. */
export async function singleMessageRequest(req: Request): Promise<Request | Response> {
  const tooLarge = () => rpcError(413, -32000, `Request body must not exceed ${MAX_MCP_BODY_BYTES} bytes.`);
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) return tooLarge();
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_MCP_BODY_BYTES) return tooLarge();
  // Valid JSON that starts with "[" is an array, i.e. a batch. Anything else malformed is left to the SDK (-32700).
  if (body.trimStart().startsWith('[')) return rpcError(400, -32600, 'Batch requests are not supported. Send one JSON-RPC message per request.');
  return new Request(req.url, { method: req.method, headers: req.headers, body });
}
