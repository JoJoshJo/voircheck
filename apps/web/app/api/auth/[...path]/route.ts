import { getAuth } from '../../../../lib/auth/server';

// Resolved per request (not at import), so the build never needs the auth env vars.
type Handler = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
const handlers = () => getAuth().handler() as unknown as { GET: Handler; POST: Handler };

export const GET: Handler = (req, ctx) => handlers().GET(req, ctx);
export const POST: Handler = (req, ctx) => handlers().POST(req, ctx);
