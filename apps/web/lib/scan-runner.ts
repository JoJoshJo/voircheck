import 'server-only';
import { demoPeersForUrl, searchProducts } from '@voircheck/agent/search';
import { anthropicAnalyzer, anthropicResearcher, kernelVisitor, notChecked, placeholderAnalyzer, scanStore, type FindOffers, type PageAnalyzer, type ScanProgress, type WebResearcher } from '@voircheck/scanner';
import { searchCache } from './search-cache';
import { latestVerdictForStore, saveScan, type ScanRecord } from './scans';
import { AI_RESERVE_PER_SCAN_USD, DailyCapError, RESEARCH_RESERVE_PER_SCAN_USD, recordResearchSpendQuietly, recordSpendQuietly, reserveAiScan, reserveKernelScan, reserveResearch } from './spend';

/** At most this many fresh scans (KERNEL sessions) run at once across the whole app (one Render instance). */
export const MAX_FRESH_SCANS_RUNNING = 5;
const running = globalThis as typeof globalThis & { __voircheckScansRunning?: number };

/** Thrown when MAX_FRESH_SCANS_RUNNING scans are already running: callers say "try again in a minute". */
export class ScanBusyError extends Error {
  constructor() {
    super('too many scans running');
    this.name = 'ScanBusyError';
  }
}

export const freshScansRunning = () => running.__voircheckScansRunning ?? 0;

// One analyzer per process: it holds the 24h per-URL AI result cache (on globalThis so a dev hot reload keeps it).
const g = globalThis as typeof globalThis & { __voircheckAnalyzer?: PageAnalyzer; __voircheckResearcher?: WebResearcher };
function pageAnalyzer(): PageAnalyzer {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return placeholderAnalyzer;
  return (g.__voircheckAnalyzer ??= anthropicAnalyzer({ apiKey, model: process.env.SCAN_MODEL }));
}

/** Research step (Claude + web search, 24h cache per domain/product). Off without an Anthropic key or RESEARCH=off. */
function webResearcher(): WebResearcher | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || process.env.RESEARCH === 'off') return null;
  return (g.__voircheckResearcher ??= anthropicResearcher({ apiKey, model: process.env.SCAN_MODEL }));
}

/** Research has a key but no budget left today: said plainly, nothing searched. */
const budgetUsedUp: WebResearcher = {
  reputation: async () => ({ reputation: notChecked("Today's web search budget is used up, so what the web says wasn't checked."), usage: null }),
  prices: async () => ({ offers: null, usage: null }),
};

/**
 * One store scan, shared by check-a-link, the shopping agent and MCP check_store. The page is only ever opened inside
 * KERNEL; this server does RDAP, DNS, TLS and Safe Browsing lookups only, behind the scanner's SSRF guards. The result
 * is saved (24h cache) and returned as the stored row.
 *
 * Budget: a KERNEL session and the page analysis are reserved against today's caps before anything runs. No KERNEL
 * reservation → DailyCapError (callers show the calm "daily limit reached" message). No AI reservation → the scan
 * runs with page analysis "unavailable". When the scan ends, the AI reservation is settled to the real cost, and the
 * KERNEL one is released if KERNEL was never used (the scan failed before the visit, e.g. an SSRF refusal).
 */
export async function runStoreScan(opts: { url: string; demoMode: boolean; liveView: boolean; onProgress?: (e: ScanProgress) => void }): Promise<ScanRecord> {
  // Checked and taken in the same synchronous step, so concurrent requests can't all slip past it.
  if (freshScansRunning() >= MAX_FRESH_SCANS_RUNNING) throw new ScanBusyError();
  running.__voircheckScansRunning = freshScansRunning() + 1;
  // The KERNEL browser is deleted in the background after its pages are read; the slot stays taken until it is gone,
  // so at most MAX_FRESH_SCANS_RUNNING browsers ever exist at once.
  const cleanups: Promise<void>[] = [];
  try {
    return await runReservedScan(opts, (p) => cleanups.push(p));
  } finally {
    void Promise.allSettled(cleanups).then(() => {
      running.__voircheckScansRunning = Math.max(0, freshScansRunning() - 1);
    });
  }
}

async function runReservedScan(opts: { url: string; demoMode: boolean; liveView: boolean; onProgress?: (e: ScanProgress) => void }, onCleanup: (done: Promise<void>) => void): Promise<ScanRecord> {
  const demo = opts.demoMode ? demoPeersForUrl(opts.url, process.env.DEMO_STORES_BASE_URL) : null;
  const kernelKey = process.env.KERNEL_API_KEY;
  // Each peer's own latest verdict: a BLOCK store's price must not enter this store's price comparison.
  const peers = demo ? await Promise.all(demo.peers.map(async (p) => ({ url: p.url, productTitle: p.productTitle, verdict: await latestVerdictForStore(p.storeUrl) }))) : [];
  if (kernelKey && !(await reserveKernelScan())) throw new DailyCapError();
  let kernelUsed = false;
  let aiReserved = 0;
  let aiUsd = 0;
  let aiRan = false;
  let researchReserved = 0;
  let researchUsd: number | null = null;
  try {
    // The research step has its own budget; no reservation → "what the web says" is not checked, the scan goes on.
    const researcher = webResearcher();
    if (researcher && (await reserveResearch())) researchReserved = RESEARCH_RESERVE_PER_SCAN_USD;
    const real = pageAnalyzer();
    if (real !== placeholderAnalyzer && (await reserveAiScan())) aiReserved = AI_RESERVE_PER_SCAN_USD;
    const analyzer: PageAnalyzer = aiReserved
      ? {
          analyze: (p) => {
            aiRan = true;
            return real.analyze(p);
          },
        }
      : placeholderAnalyzer;
    const visitor = kernelKey ? kernelVisitor({ apiKey: kernelKey, liveView: opts.liveView, replay: true, proxyId: process.env.KERNEL_PROXY_ID || undefined, onCleanup }) : null;
    const { result, meta } = await scanStore(
      { url: opts.url, peers, productTitle: demo?.productTitle },
      {
        visitor: visitor && {
          visit: (urls, hooks) => {
            kernelUsed = true;
            return visitor.visit(urls, hooks);
          },
        },
        safeBrowsingKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY,
        analyzer,
        findOffers: findOffers(),
        researcher: researchReserved ? researcher : researcher ? budgetUsedUp : null,
        verdictFor: latestVerdictForStore,
        onProgress: opts.onProgress,
      },
    );
    aiUsd = meta.ai?.costUsd ?? 0;
    researchUsd = meta.research.reduce((n, u) => n + u.costUsd, 0);
    aiRan = false; // settled to the real cost below
    return await saveScan(result);
  } finally {
    void recordSpendQuietly(settlement({ aiReserved, aiUsd, aiRan, kernelReserved: !!kernelKey, kernelUsed }));
    // A research step that never reported (the scan failed, or it ran past its deadline) keeps its reservation.
    if (researchReserved && researchUsd !== null) void recordResearchSpendQuietly(researchUsd - researchReserved);
  }
}

/**
 * Pasted-link price check (spec 5.6): other stores' offers for the page's product, from Channel3 (10-minute cache),
 * each with that store's own latest verdict so BLOCK stores are left out. No key → not compared.
 */
export function findOffers(apiKey = process.env.CHANNEL3_API_KEY, search = searchProducts, verdictFor = latestVerdictForStore): FindOffers | undefined {
  if (!apiKey) return undefined;
  return async (name) => {
    const found = await search(name, 20, { apiKey, cache: searchCache() });
    if (found.status === 'no_results') return [];
    if (found.status !== 'ok') return null;
    const verdicts = new Map<string, Awaited<ReturnType<typeof verdictFor>>>();
    for (const r of found.results) if (!verdicts.has(r.storeUrl)) verdicts.set(r.storeUrl, await verdictFor(r.storeUrl).catch(() => undefined));
    return found.results.map((r) => ({ title: r.title, price: r.price, currency: r.currency, storeUrl: r.storeUrl, verdict: verdicts.get(r.storeUrl) }));
  };
}

/**
 * What to add to today's row when a scan ends, on top of its reservations: the real AI cost minus the reservation
 * (an analysis that ran but never reported its cost keeps the whole reservation), and −1 KERNEL session when KERNEL
 * was reserved but never used.
 */
export function settlement(s: { aiReserved: number; aiUsd: number; aiRan: boolean; kernelReserved: boolean; kernelUsed: boolean }): { anthropicUsd: number; kernelScans: number } {
  return {
    anthropicUsd: s.aiRan ? 0 : s.aiUsd - s.aiReserved,
    kernelScans: s.kernelReserved && !s.kernelUsed ? -1 : 0,
  };
}
