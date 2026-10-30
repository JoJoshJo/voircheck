import 'server-only';
import { getAuth } from './server';

/** Neon Auth's API route handlers, resolved per call (never at build time). */
export type AuthRouteHandler = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
export const authHandlers = () => getAuth().handler() as unknown as { GET: AuthRouteHandler; POST: AuthRouteHandler };
