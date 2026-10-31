import type { RefusalReason, StoreOffer } from '@voircheck/agent';
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
  | { type: 'stores'; stores: AgentStore[] }
  | { type: 'scan_start'; storeId: string }
  | { type: 'scan_signal'; storeId: string; id: ScanView['signals'][number]['id']; status: ScanView['signals'][number]['status'] }
  | { type: 'scan_done'; storeId: string; scan: ScanView; cached: boolean }
  | { type: 'scan_failed'; storeId: string; reason: 'rate_limited' | 'failed' | 'unknown_store' }
  | { type: 'order'; storeId: string; paymentId: string; orderId: string }
  | { type: 'refused'; storeId: string; reason: z.infer<typeof RefusalReason> }
  | { type: 'payment'; paymentId: string; status: string }
  | { type: 'error'; code: 'auth' | 'rate' | 'busy' | 'bad_request' | 'model' | 'failed' }
  | { type: 'done' };
