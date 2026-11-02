import 'server-only';
import { demoPeersForUrl } from '@voircheck/agent/search';
import { anthropicAnalyzer, kernelVisitor, placeholderAnalyzer, scanStore, type PageAnalyzer, type ScanProgress } from '@voircheck/scanner';
import { latestVerdictForStore, saveScan, type ScanRecord } from './scans';
import { anthropicCapReached, recordSpendQuietly } from './spend';

// One analyzer per process: it holds the 24h per-URL AI result cache (on globalThis so a dev hot reload keeps it).
const g = globalThis as typeof globalThis & { __voircheckAnalyzer?: PageAnalyzer };
function pageAnalyzer(): PageAnalyzer {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return placeholderAnalyzer;
  return (g.__voircheckAnalyzer ??= anthropicAnalyzer({ apiKey, model: process.env.SCAN_MODEL }));
}

/**
 * One store scan, shared by check-a-link and the shopping agent. The page is only ever opened inside KERNEL; this
 * server does RDAP, DNS, TLS and Safe Browsing lookups only, behind the scanner's SSRF guards. The result is saved
 * (24h cache) and returned as the stored row.
 */
export async function runStoreScan(opts: { url: string; demoMode: boolean; liveView: boolean; onProgress?: (e: ScanProgress) => void }): Promise<ScanRecord> {
  const demo = opts.demoMode ? demoPeersForUrl(opts.url, process.env.DEMO_STORES_BASE_URL) : null;
  const kernelKey = process.env.KERNEL_API_KEY;
  // Each peer's own latest verdict: a BLOCK store's price must not enter this store's price comparison.
  const peers = demo ? await Promise.all(demo.peers.map(async (p) => ({ url: p.url, productTitle: p.productTitle, verdict: await latestVerdictForStore(p.storeUrl) }))) : [];
  // Past today's Anthropic cap the scan still runs; page analysis just says "unavailable".
  const analyzer = (await anthropicCapReached()) ? placeholderAnalyzer : pageAnalyzer();
  let aiUsd = 0;
  try {
    const { result, meta } = await scanStore(
      { url: opts.url, peers, productTitle: demo?.productTitle },
      {
        visitor: kernelKey ? kernelVisitor({ apiKey: kernelKey, liveView: opts.liveView, replay: true, proxyId: process.env.KERNEL_PROXY_ID || undefined }) : null,
        safeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY,
        analyzer,
        onProgress: opts.onProgress,
      },
    );
    aiUsd = meta.ai?.costUsd ?? 0;
    return await saveScan(result);
  } finally {
    // Counted even when the scan fails: KERNEL was used either way.
    void recordSpendQuietly({ anthropicUsd: aiUsd, kernelScans: kernelKey ? 1 : 0 });
  }
}
