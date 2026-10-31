import { detectBlockedPage } from './blocked-page';
import { domainInfo } from './domain';
import type { PageSnapshot, PageVisit, PageVisitor, KernelVisit } from './kernel';
import { ScanInput, ScanResult, type SignalId, type SignalStatus } from './schema';
import { score, WEIGHTS } from './scoring';
import { placeholderAnalyzer, type PageAnalyzer } from './signals/ai-page';
import { evaluateClone, type CloneSubject } from './signals/clone';
import { domainAgeSignal } from './signals/domain-age';
import { evaluatePrice, findPriceNear, normalizeTitle } from './signals/price';
import { evaluateSsl, makeTlsChecker, safeTlsCheck, type TlsChecker } from './signals/ssl';
import { threatListSignal } from './signals/threat-list';
import { errorMessage, unavailable, type Fetch, type ScanFacts, type SignalOutcome } from './signals/types';
import { assertSafeUrlShape, resolvePublicHost, SsrfError, type Resolver } from './ssrf';

export interface ScannerDeps {
  /** null = no cloud browser available; the scan then can't verify the store (never SAFE). */
  visitor: PageVisitor | null;
  analyzer?: PageAnalyzer;
  safeBrowsingKey?: string;
  fetch?: Fetch;
  resolve?: Resolver;
  tlsCheck?: TlsChecker;
  now?: () => Date;
  /** Live progress for the scan UI: the browser session as soon as it opens, then each signal as it finishes. */
  onProgress?: (event: ScanProgress) => void;
}

export type ScanProgress =
  | { type: 'browser'; sessionId: string; liveViewUrl?: string }
  | { type: 'signal'; id: SignalId; status: SignalStatus; points: number };

export interface ScanReport {
  result: ScanResult;
  /** Operational info for logs/cost tracking; not part of the user-facing result. */
  meta: { kernelSessionSeconds: number | null; kernelError: string | null };
}

const okPage = (v: PageVisit | undefined): PageSnapshot | null => (v?.ok ? v.page : null);

/**
 * Which store a URL belongs to: its host, plus the store segment when several stores share one host under /s/<slug>
 * (our demo stores on Render). Two pages of the same store compare as the same store.
 */
export function storeKey(raw: string): string {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const sub = u.pathname.match(/^\/s\/([^/]+)/)?.[1];
  return sub ? `${host}/s/${sub.toLowerCase()}` : host;
}

export async function scanStore(rawInput: ScanInput, deps: ScannerDeps): Promise<ScanReport> {
  const input = ScanInput.parse(rawInput);
  const now = deps.now?.() ?? new Date();
  const fetchImpl = deps.fetch ?? fetch;
  const tlsCheck = deps.tlsCheck ?? makeTlsChecker(deps.resolve);

  // SSRF (spec 5.17): shape-check every URL and resolve-then-check every host before anything else runs.
  const url = assertSafeUrlShape(input.url);
  const peerUrls = input.peers.map((p) => assertSafeUrlShape(p.url));
  await Promise.all([url, ...peerUrls].map((u) => resolvePublicHost(u.hostname, deps.resolve)));
  const domain = domainInfo(url.href);

  const emit = (o: SignalOutcome) => {
    try {
      deps.onProgress?.({ type: 'signal', id: o.id, status: o.status, points: WEIGHTS[o.id][o.status] });
    } catch {
      // A broken listener must never break the scan.
    }
  };
  const onSession = (s: { sessionId: string; liveViewUrl?: string }) => {
    try {
      deps.onProgress?.({ type: 'browser', ...s });
    } catch {
      // ignore
    }
  };

  const [visit, domainAge, tlsInput] = await Promise.all([
    deps.visitor
      ? deps.visitor.visit([url.href, ...peerUrls.map((u) => u.href)], { onSession }).catch((err): KernelVisit | Error => (err instanceof Error ? err : new Error(String(err))))
      : Promise.resolve(new Error('no cloud browser configured')),
    domainAgeSignal(domain, now, fetchImpl).then((r) => {
      emit(r.outcome);
      return r;
    }),
    safeTlsCheck(tlsCheck, url.hostname),
  ]);

  const kernel = visit instanceof Error ? null : visit;
  const targetVisit = kernel?.pages[0];
  // What the browser actually loaded (for redirects/HTTPS), and the page content signals may judge: a bot check,
  // error page or empty shell isn't the store, so content signals get nothing and the scan can't verify it.
  const loadedPage = okPage(targetVisit);
  const blocked = loadedPage ? detectBlockedPage(loadedPage) : null;
  const targetPage = blocked ? null : loadedPage;
  const kernelError = visit instanceof Error ? errorMessage(visit) : targetVisit && !targetVisit.ok ? targetVisit.error : blocked ? blocked.message : null;
  const peerPages = input.peers.map((_, i) => okPage(kernel?.pages[i + 1]));

  // SSL & redirects: if KERNEL ended on another host, check that host's certificate too (after its own SSRF check).
  let tls = tlsInput;
  if (loadedPage) {
    const finalHost = new URL(loadedPage.finalUrl).hostname;
    if (finalHost !== url.hostname) {
      try {
        assertSafeUrlShape(loadedPage.finalUrl);
        tls = await safeTlsCheck(tlsCheck, finalHost);
      } catch (err) {
        tls = { valid: false, error: err instanceof SsrfError ? `redirect target blocked: ${err.message}` : errorMessage(err) };
      }
    }
  }
  const ssl = evaluateSsl({ url: url.href, navigation: loadedPage && { finalUrl: loadedPage.finalUrl, redirectChain: loadedPage.redirectChain }, tls, now });
  emit(ssl.outcome);

  // Price: the item title comes from the caller, the peers, or the product page's heading.
  const title = input.productTitle ?? input.peers.find((p) => p.productTitle)?.productTitle ?? targetPage?.h1 ?? null;
  const ownPrice = input.price ?? (targetPage && title ? findPriceNear(targetPage.visibleText, title) : null);
  // Comparison set: only the exact same product, never this store itself, never a store VoirCheck blocked.
  const sameItem = (peerTitle: string | undefined) => !peerTitle || !title || normalizeTitle(peerTitle) === normalizeTitle(title);
  const self = storeKey(url.href);
  const excludedBlocked = input.peers.filter((p) => p.verdict === 'BLOCK' && storeKey(p.url) !== self).length;
  const peerPrices = input.peers
    .map((p, i) => {
      if (storeKey(p.url) === self || p.verdict === 'BLOCK' || p.sameProduct === false || !sameItem(p.productTitle)) return null;
      if (p.price !== undefined) return p.price;
      const page = peerPages[i];
      const peerTitle = p.productTitle ?? title;
      return page && peerTitle ? findPriceNear(page.visibleText, peerTitle) : null;
    })
    .filter((x): x is number => x !== null);
  const price =
    ownPrice === null && !targetPage
      ? { outcome: unavailable('price', blocked ? `Couldn't read the store page: ${blocked.message}, so its price is unknown.` : `Couldn't load the store page in the cloud browser, so its price is unknown.`), belowPct: null }
      : evaluatePrice({ price: ownPrice, title, peerPrices, sameProduct: input.sameProduct, excludedBlocked });
  emit(price.outcome);

  const threatUrls = [...new Set([url.href, targetPage?.finalUrl].filter((u): u is string => !!u))];
  const [threat, ai] = await Promise.all([
    threatListSignal(threatUrls, deps.safeBrowsingKey, fetchImpl).then((r) => {
      emit(r.outcome);
      return r;
    }),
    (deps.analyzer ?? placeholderAnalyzer)
      .analyze(targetPage && { url: targetPage.finalUrl, fullText: targetPage.fullText, visibleText: targetPage.visibleText })
      .catch(() => unavailable('ai_page', 'AI analysis failed.'))
      .then((o) => (blocked && o.status === 'unavailable' ? { ...o, evidence: [`Couldn't read the store page: ${blocked.message}.`, ...o.evidence] } : o))
      .then((o) => {
        emit(o);
        return o;
      }),
  ]);

  const subject = (u: string, page: PageSnapshot | null): CloneSubject => ({
    url: u,
    siteName: page?.siteName ?? null,
    page: page ? { visibleText: [page.visibleText, page.aboutText].filter(Boolean).join('\n'), structure: page.structure } : undefined,
  });
  const clone = evaluateClone(
    subject(url.href, targetPage),
    peerUrls.map((u, i) => subject(u.href, peerPages[i] ?? null)),
  );
  if (blocked && input.peers.length) clone.evidence.unshift(`Couldn't read the store page: ${blocked.message}; only the web addresses were compared.`);
  emit(clone);

  const facts: ScanFacts = {
    domainAgeDays: domainAge.ageDays,
    validHttps: ssl.validHttps,
    priceBelowPeersPct: price.belowPct,
    threatHit: threat.hit,
    kernelOk: !!targetPage,
  };
  const scored = score([domainAge.outcome, ssl.outcome, price.outcome, ai, threat.outcome, clone], facts);
  if (!targetPage) {
    scored.signals
      .find((s) => s.id === 'ssl_redirects')
      ?.evidence.push(blocked ? `Couldn't verify this store: ${blocked.message}, so the cloud browser never saw the shop itself.` : `Couldn't verify this store: the cloud browser visit failed (${kernelError ?? 'unknown error'}).`);
  }

  const result = ScanResult.parse({
    url: url.href,
    domain: domain.site ?? domain.hostname,
    ...scored,
    kernel: { sessionId: kernel?.sessionId ?? null, liveViewUrl: kernel?.liveViewUrl, replayUrl: kernel?.replayUrl },
    scannedAt: now.toISOString(),
  });
  return { result, meta: { kernelSessionSeconds: kernel?.sessionSeconds ?? null, kernelError } };
}
