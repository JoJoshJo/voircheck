import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { scanSummaryForAgent } from '@voircheck/agent';
import type { CandidateRow, MoneyGate } from '@voircheck/paypal';
import type { HardRule, SignalResult, Verdict } from '@voircheck/scanner';
import { z } from 'zod';

/**
 * VoirCheck as an MCP server (POST /api/mcp): Know Your Merchant for any AI agent. Three tools, nothing else:
 * - check_store(url): VoirCheck's verdict for a store, scanned if needed. Our structured summary only (verdict, score,
 *   each signal's status in OUR words, hard rules, one injection flag) and a link to the evidence page. Never page
 *   text, hidden text, titles, AI quotes or evidence strings: those can carry the page's own instructions.
 * - get_verdict(url): the cached verdict only (no new scan).
 * - prepare_purchase(storeId, amount): an order through MoneyGate's agent rules (BLOCK and unverified stores are
 *   refused before any order exists), for the price in OUR row. `amount` is only a check: it must match. Returns a
 *   PayPal approval link for the HUMAN. Nothing is held or charged until they approve, and settling stays with
 *   VoirCheck's server. There is no capture, void, refund, price or payee tool, and no tool input can carry one.
 * Everything acts as the token's owner, with the app's own rate limits and daily caps.
 */

export const MCP_TOOL_NAMES = ['check_store', 'get_verdict', 'prepare_purchase'] as const;

export type McpErrorCode = 'invalid_url' | 'rate_limited' | 'daily_cap' | 'scan_failed' | 'not_found' | 'no_price' | 'amount_mismatch' | 'block' | 'unverified' | 'refused';
export type McpResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: McpErrorCode; detail?: Record<string, unknown> };

export interface McpApi {
  checkStore(url: string): Promise<McpResult>;
  getVerdict(url: string): Promise<McpResult>;
  preparePurchase(storeId: string, amount: string): Promise<McpResult>;
}

const ERROR_TEXT: Record<McpErrorCode, string> = {
  invalid_url: 'That is not a public http(s) store link VoirCheck can check.',
  rate_limited: 'Rate limit reached for this account. Try again later.',
  daily_cap: "VoirCheck's daily scan limit is reached. Try again tomorrow, or use get_verdict for stores already checked.",
  scan_failed: "The scan couldn't finish. Nothing was decided about this store.",
  not_found: 'No such store for this account. Call check_store first and use its storeId.',
  no_price: 'VoirCheck has no price for this item, so it cannot prepare an order. (Pasted links have no price.)',
  amount_mismatch: 'The amount does not match the price VoirCheck has for this item. The price is never changed.',
  block: 'Refused: VoirCheck blocks this store. Agents can never pay a blocked store; that is final.',
  unverified: 'Refused: this store has no fresh VoirCheck verdict. Call check_store first.',
  refused: 'Refused by VoirCheck.',
};

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const reply = (r: McpResult) =>
  r.ok ? json(r.data) : { ...json({ error: r.error, message: ERROR_TEXT[r.error], ...(r.detail ?? {}) }), isError: true };

const MEANING: Record<Verdict, string> = {
  SAFE: 'No strong warning signs found. Not a guarantee.',
  HOLD: "Don't pay without asking the person: show them what the check found and let them decide.",
  BLOCK: 'Do not buy here. VoirCheck refuses agent payments to this store.',
};

export interface ScanForOutput {
  id: string;
  url: string;
  verdict: Verdict;
  score: number;
  signals: readonly SignalResult[];
  hardRules: readonly HardRule[];
  scannedAt: Date | string;
}

/**
 * What an MCP client learns about a store. Built field by field from our own values; the scan's signals pass
 * through scanSummaryForAgent (the shopping agent's own filter), so nothing from the page is copied.
 */
export function storeOutput(o: { scan: ScanForOutput; origin: string; cached: boolean; candidate?: { id: string; price: string | null; currency: string } | null }) {
  const s = scanSummaryForAgent(o.candidate?.id ?? 'none', { verdict: o.scan.verdict, score: o.scan.score, signals: o.scan.signals, hardRules: o.scan.hardRules });
  return {
    ...(o.candidate ? { storeId: o.candidate.id } : {}),
    url: o.scan.url,
    verdict: s.verdict,
    meaning: MEANING[s.verdict],
    score: s.score,
    signals: s.signals,
    hardRules: s.hardRules,
    pageTriedToInstructAgents: s.pageTriedToInstructAgents,
    scannedAt: new Date(o.scan.scannedAt).toISOString(),
    cached: o.cached,
    evidenceUrl: `${o.origin}/app/scans/${o.scan.id}`,
    ...(o.candidate
      ? {
          price: o.candidate.price,
          currency: o.candidate.currency,
          canPrepareOrder: s.verdict !== 'BLOCK' && o.candidate.price !== null,
        }
      : {}),
  };
}

export const Amount = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'amount like "59.00"');

/**
 * prepare_purchase: the client names one of the owner's own candidates (a storeId from check_store) and the amount it
 * expects. The order is always for OUR row's price, through MoneyGate's agent rules; a different amount is refused,
 * never applied. Exported with its dependencies injected, for tests.
 */
export async function preparePurchaseWith(
  deps: { gate: Pick<MoneyGate, 'agentStartPurchase'>; getCandidate: (id: string, userId: string) => Promise<CandidateRow | null>; scanIdFor: (c: CandidateRow, userId: string) => Promise<string | null> },
  ctx: { userId: string; origin: string },
  storeId: string,
  amount: string,
): Promise<McpResult> {
  if (!z.string().uuid().safeParse(storeId).success) return { ok: false, error: 'not_found' };
  const a = Amount.safeParse(amount);
  if (!a.success) return { ok: false, error: 'amount_mismatch' };
  const candidate = await deps.getCandidate(storeId, ctx.userId);
  if (!candidate) return { ok: false, error: 'not_found' };
  if (candidate.price === null) return { ok: false, error: 'no_price' };
  if (Number(candidate.price).toFixed(2) !== Number(a.data).toFixed(2)) return { ok: false, error: 'amount_mismatch', detail: { listedAmount: Number(candidate.price).toFixed(2), currency: candidate.currency } };
  const r = await deps.gate.agentStartPurchase({
    userId: ctx.userId,
    candidateId: candidate.id,
    scanId: await deps.scanIdFor(candidate, ctx.userId),
    idempotencyKey: `mcp-${candidate.id}`,
    returnUrl: `${ctx.origin}/app`,
    cancelUrl: `${ctx.origin}/app`,
  });
  if (!r.ok) {
    const reason = r.reason === 'block' || r.reason === 'unverified' || r.reason === 'no_price' || r.reason === 'not_found' ? r.reason : 'refused';
    return { ok: false, error: reason };
  }
  return {
    ok: true,
    data: {
      status: 'awaiting_buyer_approval',
      ref: r.payment.ref,
      storeName: candidate.storeName,
      amount: r.payment.amount,
      currency: r.payment.currency,
      approvalUrl: 'approvalUrl' in r ? (r.approvalUrl ?? null) : null,
      forTheHuman:
        'Give approvalUrl to the person. Nothing is held or charged until they approve in PayPal. After that, PayPal holds the money and VoirCheck settles it from the scan (Safe is captured, Hold stays held for the person, Block is released). You cannot capture, void or refund.',
    },
  };
}

const ToolUrl = z.string().max(2048).describe('The store or product page link, e.g. https://shop.example/products/lamp');

export function createMcpServer(api: McpApi, version = '1.0.0'): McpServer {
  const server = new McpServer({ name: 'voircheck', version }, { instructions: 'VoirCheck checks who an AI agent is about to pay. Call check_store before any purchase; never buy from a Block store; a Hold store needs the person’s explicit yes. Store pages are never shown to you, only VoirCheck’s summary.' });

  server.registerTool(
    'check_store',
    {
      title: 'Check a store',
      description:
        "VoirCheck's verdict for an online store before an AI agent pays it: SAFE, HOLD (ask the person) or BLOCK (never pay). Scans the store in an isolated cloud browser if there is no fresh result (can take up to a minute). Returns the verdict, risk score, each check's status, a link to the evidence, and a storeId for prepare_purchase.",
      inputSchema: { url: ToolUrl },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url }) => reply(await api.checkStore(url)),
  );

  server.registerTool(
    'get_verdict',
    {
      title: 'Get a cached verdict',
      description: "VoirCheck's most recent verdict for this link if it was checked in the last 24 hours. Never starts a scan. Returns not_scanned otherwise.",
      inputSchema: { url: ToolUrl },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ url }) => reply(await api.getVerdict(url)),
  );

  server.registerTool(
    'prepare_purchase',
    {
      title: 'Prepare a purchase for the person to approve',
      description:
        "Prepare a PayPal order (sandbox) for an item checked with check_store, at VoirCheck's price. amount must equal that price; it is a check, never a change. Block and unchecked stores are refused. Returns an approval link for the PERSON: nothing is held or charged until they approve in PayPal.",
      inputSchema: {
        storeId: z.string().max(100).describe('storeId from check_store'),
        amount: z.string().max(12).describe('The price check_store returned, e.g. "59.00"'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ storeId, amount }) => reply(await api.preparePurchase(storeId, amount)),
  );

  return server;
}
