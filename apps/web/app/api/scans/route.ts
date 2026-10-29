import { demoPeersForUrl } from '@voircheck/agent/search';
import { assertSafeUrlShape, kernelVisitor, scanStore, SsrfError, StoreUrl } from '@voircheck/scanner';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { checkScanLimits } from '../../../lib/rate-limit';
import { canonicalUrl, findFreshScan, finishLinkRequest, latestVerdictForStore, recordLinkRequest, saveScan } from '../../../lib/scans';
import { toScanView, type ScanEvent } from '../../../lib/scan-view';
import { getCurrentUser, getProfile } from '../../../lib/user';
import { DEMO_COOKIE, demoModeFrom } from '../../../lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.object({ url: z.string().max(2048), rescan: z.boolean().default(false) });

/**
 * Check-a-link (spec 5.3 / 5.5). The store page is only ever opened inside KERNEL; this server does RDAP, DNS,
 * TLS and Safe Browsing lookups only, behind the scanner's SSRF guards. Streams NDJSON progress to the owner.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const encoder = new TextEncoder();
  const line = (e: ScanEvent) => encoder.encode(`${JSON.stringify(e)}\n`);
  const oneShot = (e: ScanEvent, status: number) => new Response(line(e), { status, headers: { 'content-type': 'application/x-ndjson' } });

  if (!user || !(await getProfile(user.id))) return oneShot({ type: 'error', code: 'auth' }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !StoreUrl.safeParse(parsed.data.url).success) return oneShot({ type: 'error', code: 'url' }, 400);
  let url: string;
  try {
    url = canonicalUrl(assertSafeUrlShape(parsed.data.url).href);
  } catch {
    return oneShot({ type: 'error', code: 'url' }, 400);
  }

  const demoMode = demoModeFrom((await cookies()).get(DEMO_COOKIE)?.value);
  const cached = parsed.data.rescan ? null : await findFreshScan(url);
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const limit = await checkScanLimits({ userId: user.id, isGuest: user.isGuest, ip, fresh: !cached });
  if (!limit.ok) return oneShot({ type: 'error', code: 'rate' }, 429);

  const demo = demoMode ? demoPeersForUrl(url, process.env.DEMO_STORES_BASE_URL) : null;
  const host = new URL(url).hostname;
  const candidateFields = {
    storeName: demo?.storeName ?? host,
    storeUrl: demo?.storeUrl ?? url,
    productTitle: demo?.productTitle ?? host,
    price: demo ? demo.price.toFixed(2) : null,
    source: demo ? ('demo' as const) : ('link' as const),
  };
  const { sessionId, candidateId } = await recordLinkRequest({ userId: user.id, url, demoMode, ...candidateFields });
  const candidate = { id: candidateId, storeName: candidateFields.storeName, productTitle: candidateFields.productTitle, price: candidateFields.price, currency: 'USD' };

  if (cached) {
    await finishLinkRequest(user.id, sessionId, 'done');
    return oneShot({ type: 'cached', scan: toScanView(cached), candidate }, 200);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ScanEvent) => {
        try {
          controller.enqueue(line(e));
        } catch {
          // client went away; the scan still finishes and is saved
        }
      };
      send({ type: 'start', url });
      try {
        const kernelKey = process.env.KERNEL_API_KEY;
        // Each peer's own latest verdict: a BLOCK store's price must not enter this store's price comparison.
        const peers = demo ? await Promise.all(demo.peers.map(async (p) => ({ url: p.url, productTitle: p.productTitle, verdict: await latestVerdictForStore(p.storeUrl) }))) : [];
        const { result } = await scanStore(
          { url, peers, productTitle: demo?.productTitle },
          {
            visitor: kernelKey ? kernelVisitor({ apiKey: kernelKey, liveView: true, replay: true }) : null,
            safeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY,
            onProgress: (e) => {
              // The live-view link goes to this requester only and is never stored.
              if (e.type === 'browser') send({ type: 'browser', liveViewUrl: e.liveViewUrl ?? null });
              else send(e);
            },
          },
        );
        const row = await saveScan(result);
        await finishLinkRequest(user.id, sessionId, 'done');
        send({ type: 'done', scan: toScanView(row), candidate });
      } catch (err) {
        await finishLinkRequest(user.id, sessionId, 'failed').catch(() => {});
        send({ type: 'error', code: err instanceof SsrfError ? 'url' : 'failed' });
        if (!(err instanceof SsrfError)) console.error('scan failed:', err instanceof Error ? err.message : 'unknown error');
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
