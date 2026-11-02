import { MissingModelKeyError, ModelUnavailableError } from '@voircheck/agent';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { agentModel, ConversationBudgetError, openConversation, runChatTurn } from '../../../lib/agent-runtime';
import type { AgentEvent } from '../../../lib/agent-view';
import { isLang } from '../../../lib/i18n';
import { publicOrigin } from '../../../lib/app-origin';
import { clientIp } from '../../../lib/client-ip';
import { DailyCapError } from '../../../lib/spend';
import { allowAgentRequest } from '../../../lib/rate-limit';
import { getCurrentUser, getProfile } from '../../../lib/user';
import { DEMO_COOKIE, demoModeFrom } from '../../../lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({ conversationId: z.string().uuid().nullable().default(null), message: z.string().trim().min(1).max(500) });

/**
 * Shopping agent chat (spec 5.3 / 5.13). One user message per request; the conversation stays on the server.
 * Streams NDJSON events. Money actions inside the turn go through MoneyGate only.
 */
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const line = (e: AgentEvent) => encoder.encode(`${JSON.stringify(e)}\n`);
  const oneShot = (e: AgentEvent, status: number) => new Response(line(e), { status, headers: { 'content-type': 'application/x-ndjson' } });

  const user = await getCurrentUser();
  const profile = user ? await getProfile(user.id) : null;
  if (!user || !profile) return oneShot({ type: 'error', code: 'auth' }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return oneShot({ type: 'error', code: 'bad_request' }, 400);
  if (!allowAgentRequest(user.id, user.isGuest)) return oneShot({ type: 'error', code: 'rate' }, 429);

  const { id: convId, conv } = openConversation(user.id, parsed.data.conversationId);
  if (conv.busy) return oneShot({ type: 'error', code: 'busy' }, 409);
  conv.busy = true;

  const h = await headers();
  const ip = clientIp(h);
  const origin = publicOrigin(h);
  const demoMode = demoModeFrom((await cookies()).get(DEMO_COOKIE)?.value);
  const lang = isLang(profile.language) ? profile.language : 'en';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(line(e));
        } catch {
          // client went away; the turn still finishes and the conversation is kept
        }
      };
      send({ type: 'conversation', id: convId, model: agentModel().kind });
      try {
        await runChatTurn({ convId, conv, userId: user.id, isGuest: user.isGuest, ip, demoMode, origin, lang, text: parsed.data.message, send });
        send({ type: 'done' });
      } catch (err) {
        // Out of credit, bad key, overloaded: a calm "not available" (the link check still works); a budget hit = limit;
        // today's global cap = "back tomorrow".
        send({ type: 'error', code: err instanceof MissingModelKeyError || err instanceof ModelUnavailableError ? 'model' : err instanceof ConversationBudgetError ? 'rate' : err instanceof DailyCapError ? 'cap' : 'failed' });
        console.error('agent turn failed:', err instanceof Error ? err.message : 'unknown error');
      } finally {
        conv.busy = false;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
