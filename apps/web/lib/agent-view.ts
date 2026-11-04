import type { RefusalReason, StoreOffer } from '@voircheck/agent';
import { parseQuickReplies } from '@voircheck/agent/quick-replies';
import type { z } from 'zod';
import type { ScanView } from './scan-view';

/**
 * What the chat UI gets from /api/agent (NDJSON). The browser may see full scan evidence (rendered as text, like the
 * results panel); the model never does. Store IDs are candidate IDs; prices come from our rows.
 */
export type AgentStore = z.infer<typeof StoreOffer>;

export type AgentEvent =
  | { type: 'conversation'; id: string; model: 'fake' | 'claude' }
  | { type: 'text'; text: string }
  /** Tap-to-send suggestions for the agent's latest message (labels only; a tap sends the label as the person's message). */
  | { type: 'replies'; replies: string[] }
  | { type: 'stores'; stores: AgentStore[] }
  | { type: 'scan_start'; storeId: string }
  | { type: 'scan_signal'; storeId: string; id: ScanView['signals'][number]['id']; status: ScanView['signals'][number]['status'] }
  | { type: 'scan_done'; storeId: string; scan: ScanView; cached: boolean }
  | { type: 'scan_failed'; storeId: string; reason: 'rate_limited' | 'failed' | 'unknown_store' }
  | { type: 'order'; storeId: string; paymentId: string; orderId: string; ref: string }
  | { type: 'refused'; storeId: string; reason: z.infer<typeof RefusalReason> }
  | { type: 'payment'; paymentId: string; status: string }
  /** request_refund: the agent proposed a refund; the person's button decides (POST /api/pay/refund). */
  | { type: 'refund_offer'; paymentId: string; ref: string; store: string; amount: string; currency: string }
  | { type: 'error'; code: 'auth' | 'rate' | 'cap' | 'busy' | 'bad_request' | 'model' | 'failed' }
  | { type: 'done' };

/** One agent message as chat events: its text, then its quick replies (the model's `[[replies: …]]` line, validated). */
export function agentTextEvents(raw: string): AgentEvent[] {
  const { text, replies } = parseQuickReplies(raw);
  return [...(text ? [{ type: 'text' as const, text }] : []), ...(replies.length ? [{ type: 'replies' as const, replies }] : [])];
}

/** A person can't fake the server's "[VoirCheck update: …]" line: a typed one loses its opening bracket. */
export function neutralizeFakeNote(text: string): string {
  return text.replace(/^(\s*)\[(?=\s*voircheck update)/i, '$1(');
}
