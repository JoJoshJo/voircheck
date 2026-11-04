import 'server-only';
import { demoPeersForUrl } from '@voircheck/agent/search';
import { shoppingSessions } from '@voircheck/db/schema';
import type { CandidateRow } from '@voircheck/paypal';
import { assertSafeUrlShape, SsrfError, StoreUrl } from '@voircheck/scanner';
import { ownedBy } from '@voircheck/shared';
import { eq } from 'drizzle-orm';
import type { TokenOwner } from '../api-tokens';
import { getDb } from '../db';
import { getPayPal } from '../paypal';
import { allowAgentRequest, checkScanLimits, hitWindow } from '../rate-limit';
import { runStoreScan } from '../scan-runner';
import { DailyCapError } from '../spend';
import { canonicalUrl, findFreshScan, finishLinkRequest, recordLinkRequest } from '../scans';
import { toScanView } from '../scan-view';
import { preparePurchaseWith, storeOutput, type McpApi, type McpResult } from './core';

/** get_verdict is a database read; generous, but bounded like everything else. */
const VERDICT_READS_PER_HOUR = 60;

function safeUrl(raw: string): string | null {
  if (!StoreUrl.safeParse(raw).success) return null;
  try {
    return canonicalUrl(assertSafeUrlShape(raw).href);
  } catch {
    return null;
  }
}

/** The page the candidate was checked from (the link session's URL), so prepare_purchase finds that scan. */
async function scanIdFor(c: CandidateRow, userId: string): Promise<string | null> {
  const [session] = await getDb()
    .select({ url: shoppingSessions.queryOrUrl, entryType: shoppingSessions.entryType })
    .from(shoppingSessions)
    .where(ownedBy(shoppingSessions, userId, eq(shoppingSessions.id, c.sessionId)))
    .limit(1);
  const checked = session?.entryType === 'link' ? safeUrl(session.url) : null;
  const scan = (checked ? await findFreshScan(checked) : null) ?? (safeUrl(c.storeUrl) ? await findFreshScan(safeUrl(c.storeUrl)!) : null);
  return scan?.id ?? null;
}

/** The three MCP tools, as the token's owner, with the app's own rate limits and caps. */
export function mcpApi(owner: TokenOwner, ctx: { ip: string; origin: string }): McpApi {
  const { userId, isGuest } = owner;
  return {
    async checkStore(raw): Promise<McpResult> {
      const url = safeUrl(raw);
      if (!url) return { ok: false, error: 'invalid_url' };
      const cached = await findFreshScan(url);
      const limit = await checkScanLimits({ userId, isGuest, ip: ctx.ip, fresh: !cached });
      if (!limit.ok) return { ok: false, error: limit.reason === 'global' ? 'daily_cap' : 'rate_limited' };
      // Demo store links get the demo store's price and peers (our own config), like the app's demo mode.
      const demo = demoPeersForUrl(url, process.env.DEMO_STORES_BASE_URL);
      const host = new URL(url).hostname;
      const fields = {
        storeName: demo?.storeName ?? host,
        storeUrl: demo?.storeUrl ?? url,
        productTitle: demo?.productTitle ?? host,
        price: demo ? demo.price.toFixed(2) : null,
        source: demo ? ('demo' as const) : ('link' as const),
      };
      const { sessionId, candidateId } = await recordLinkRequest({ userId, url, demoMode: !!demo, ...fields });
      try {
        const row = cached ?? (await runStoreScan({ url, demoMode: !!demo, liveView: false }));
        await finishLinkRequest(userId, sessionId, 'done');
        const view = toScanView(row);
        return { ok: true, data: storeOutput({ scan: view, origin: ctx.origin, cached: !!cached, candidate: { id: candidateId, price: fields.price, currency: 'USD' } }) };
      } catch (err) {
        await finishLinkRequest(userId, sessionId, 'failed').catch(() => {});
        if (err instanceof SsrfError) return { ok: false, error: 'invalid_url' };
        if (err instanceof DailyCapError) return { ok: false, error: 'daily_cap' };
        console.error('mcp check_store failed:', err instanceof Error ? err.message : 'unknown error');
        return { ok: false, error: 'scan_failed' };
      }
    },

    async getVerdict(raw): Promise<McpResult> {
      const url = safeUrl(raw);
      if (!url) return { ok: false, error: 'invalid_url' };
      if (!hitWindow(`mcp-verdict:${userId}`, VERDICT_READS_PER_HOUR)) return { ok: false, error: 'rate_limited' };
      const row = await findFreshScan(url);
      if (!row) return { ok: true, data: { url, status: 'not_scanned', hint: 'Call check_store to scan it.' } };
      return { ok: true, data: storeOutput({ scan: toScanView(row), origin: ctx.origin, cached: true }) };
    },

    async preparePurchase(storeId, amount): Promise<McpResult> {
      // Same per-user limit as the app's shopping agent.
      if (!allowAgentRequest(userId, isGuest)) return { ok: false, error: 'rate_limited' };
      const { gate, store } = getPayPal();
      return preparePurchaseWith({ gate, getCandidate: (id, uid) => store.getCandidateForUser(id, uid), scanIdFor }, { userId, origin: ctx.origin }, storeId, amount);
    },
  };
}
