import { detectBlockedPage, detectSentAway } from './blocked-page';
import { productFromPage, type PageProduct } from './page-facts';
import { retailerOnPage, withRetailerHit } from './signals/brand-on-page';
import { stripTracking } from './tracking';
import { notChecked, type ResearchUsage, type WebResearcher } from './research';
import { domainInfo } from './domain';
import { extractFacts, keepInScope, pickEvidenceLinks, type CollectedEvidence } from './evidence-pages';
import { filterHiddenText } from './hidden-text';
import { popularity, trancoLookup, type RankLookup } from './reputation';
import type { PageSnapshot, PageVisit, PageVisitor, KernelVisit } from './kernel';
import { ScanInput, ScanResult, type SignalId, type SignalStatus, type Verdict, type WebReputation } from './schema';
import { score, WEIGHTS } from './scoring';
import { confirmedInjection, placeholderAnalyzer, type PageAnalyzer } from './signals/ai-page';
import { brandInDomain, defaultBrandLookup, withBrandHit, type BrandLookup } from './signals/brand-domain';
import { evaluateClone, type CloneSubject } from './signals/clone';
import { domainAgeSignal } from './signals/domain-age';
import { comparablePrices, evaluatePrice, findPriceNear, normalizeTitle, PRICE, type FindOffers } from './signals/price';
import { evaluateSsl, makeTlsChecker, safeTlsCheck, type TlsChecker } from './signals/ssl';
import { threatListSignal } from './signals/threat-list';
import { errorMessage, unavailable, type AiUsage, type Fetch, type ScanFacts, type SignalOutcome } from './signals/types';
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
  /** Well-known-site lookup (registrable domain → rank). Default: the pinned Tranco list; null = don't check. */
  popularity?: RankLookup | null;
  /** Brand-in-domain lookup (clone signal). Default: built from the pinned Tranco list; null = don't check. */
  brands?: BrandLookup | null;
  /** Live progress for the scan UI: the browser session as soon as it opens, then each signal as it finishes. */
  onProgress?: (event: ScanProgress) => void;
  /** Product search for pasted links (no peers): other stores' offers for the page's product. Absent = not compared. */
  findOffers?: FindOffers;
  /** Research step (Claude + web search): what the web says about the store, and a price fallback. Absent = not checked. */
  researcher?: WebResearcher | null;
  /** A store's own latest VoirCheck verdict (web-search price offers from BLOCK stores are left out). */
  verdictFor?: (storeUrl: string) => Promise<Verdict | undefined>;
  /** How long the scan waits for the research step after it starts (default RESEARCH_DEADLINE_MS). */
  researchDeadlineMs?: number;
}

/** The scan never waits longer than this for what the web says; after it, the row is "not checked". */
export const RESEARCH_DEADLINE_MS = 35_000;

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export type ScanProgress =
  | { type: 'browser'; sessionId: string; liveViewUrl?: string }
  | { type: 'signal'; id: SignalId; status: SignalStatus; points: number }
  | { type: 'research'; status: SignalStatus };

export interface ScanReport {
  result: ScanResult;
  /** Operational info for logs/cost tracking; not part of the user-facing result. */
  meta: { kernelSessionSeconds: number | null; kernelError: string | null; ai: AiUsage | null; research: ResearchUsage[]; researchMs: number | null };
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
  // Ad/click tracking (gclid, utm_*, ...) never changes the page and is one person's click: never scanned or stored.
  const url = assertSafeUrlShape(stripTracking(input.url));
  const peerUrls = input.peers.map((p) => assertSafeUrlShape(stripTracking(p.url)));
  await Promise.all([url, ...peerUrls].map((u) => resolvePublicHost(u.hostname, deps.resolve)));
  const domain = domainInfo(url.href);
  const pop = popularity(domain, deps.popularity === undefined ? trancoLookup : deps.popularity);

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

  // Research step: what the web says about the store. It needs only the domain, so it runs alongside the page visit.
  const research: ResearchUsage[] = [];
  const startedAt = Date.now();
  let researchMs: number | null = null;
  const reputationP: Promise<WebReputation> = (deps.researcher
    ? withDeadline(
        deps.researcher.reputation(domain.registrable ?? domain.hostname).catch(() => ({ reputation: notChecked("The web search didn't complete, so what the web says wasn't checked."), usage: null })),
        deps.researchDeadlineMs ?? RESEARCH_DEADLINE_MS,
        { reputation: notChecked('The web search took too long, so what the web says wasn\'t checked.'), usage: null },
      )
    : Promise.resolve({ reputation: notChecked('The web search is off, so what the web says wasn\'t checked.'), usage: null })
  ).then(({ reputation, usage }) => {
    if (usage) research.push(usage);
    if (deps.researcher) researchMs = Date.now() - startedAt;
    try {
      deps.onProgress?.({ type: 'research', status: reputation.status });
    } catch {
      // ignore
    }
    return reputation;
  });

  const [visit, domainAge, tlsInput] = await Promise.all([
    deps.visitor
      ? deps.visitor.visit([url.href, ...peerUrls.map((u) => u.href)], { onSession, evidenceLinks: (p) => (detectSentAway(p.requestedUrl, p.finalUrl) || detectBlockedPage(p) ? [] : pickEvidenceLinks(p.links, p.finalUrl)) }).catch((err): KernelVisit | Error => (err instanceof Error ? err : new Error(String(err))))
      : Promise.resolve(new Error('no cloud browser configured')),
    domainAgeSignal(domain, now, fetchImpl).then((r) => {
      // Reputation is evidence only (no points): it rides along with domain age.
      r.outcome.evidence.push(pop.evidence);
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
  // A store that sends us to a search engine or portal hides its page: that page is not the store either.
  const blocked = loadedPage ? (detectSentAway(url.href, loadedPage.finalUrl) ?? detectBlockedPage(loadedPage)) : null;
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
  if (blocked?.detail) ssl.outcome.evidence.push(blocked.detail);
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
  const noPage = { outcome: unavailable('price', blocked ? `Couldn't read the store page: ${blocked.message}, so its price is unknown.` : `Couldn't load the store page in the cloud browser, so its price is unknown.`), belowPct: null };
  // With peers (Demo mode, the agent's comparison) the price is judged now; a pasted link waits for its product
  // (page data, else the AI's reading) and a product search below.
  const pasted = input.peers.length === 0 && input.price === undefined;
  const pageProduct: PageProduct | null = targetPage ? productFromPage(targetPage.pageFacts, targetPage.h1) : null;
  let price: { outcome: SignalOutcome; belowPct: number | null } | null = null;
  if (!pasted || !targetPage) {
    price = ownPrice === null && !targetPage ? noPage : evaluatePrice({ price: ownPrice, title, peerPrices, sameProduct: input.sameProduct, excludedBlocked });
    emit(price.outcome);
  }

  // Extra pages of the scanned store (same KERNEL session), and fixed-pattern facts over them: evidence only for now.
  const evidencePages = targetPage ? keepInScope(kernel?.evidencePages ?? [], targetPage.finalUrl) : [];
  const pageFacts = extractFacts([targetPage?.visibleText ?? '', ...evidencePages.map((p) => p.visibleText)], targetPage?.finalUrl ?? url.href);
  // Hidden-from-people text per page (filtered, injection-flagged). Evidence only; quoted, never followed.
  const readPages = targetPage
    ? [
        { url: targetPage.finalUrl, kind: 'home' as const, title: targetPage.title, hiddenText: filterHiddenText(targetPage.hiddenCandidates) },
        ...evidencePages.map((p) => ({ url: p.finalUrl, kind: p.kind, title: p.title, hiddenText: filterHiddenText(p.hiddenCandidates) })),
      ]
    : [];
  const hiddenText = readPages.flatMap((p) => p.hiddenText.map((h) => ({ ...h, pageUrl: p.url, pageKind: p.kind })));
  const collected: CollectedEvidence | undefined = targetPage
    ? {
        pages: readPages.map((p) => ({
          url: p.url,
          kind: p.kind,
          title: p.title.slice(0, 300),
          ...(p.hiddenText.length ? { hiddenText: p.hiddenText.map((h) => ({ ...h, text: h.text.slice(0, 500) })) } : {}),
        })),
        facts: pageFacts,
      }
    : undefined;

  // A pasted link whose page names its product: the price search (Channel3, then web search) runs alongside the AI.
  const priceDeps = { findOffers: deps.findOffers, researcher: deps.researcher ?? null, verdictFor: deps.verdictFor, research };
  const earlyPrice = pasted && targetPage && pageProduct ? pastedLinkPrice(pageProduct, targetPage.finalUrl, priceDeps) : null;

  const threatUrls = [...new Set([url.href, targetPage?.finalUrl].filter((u): u is string => !!u))];
  const [threat, ai] = await Promise.all([
    threatListSignal(threatUrls, deps.safeBrowsingKey, fetchImpl).then((r) => {
      emit(r.outcome);
      return r;
    }),
    (deps.analyzer ?? placeholderAnalyzer)
      .analyze(targetPage && { url: targetPage.finalUrl, fullText: targetPage.fullText, visibleText: targetPage.visibleText, pages: evidencePages, facts: pageFacts, hiddenText, wellKnownRank: pop.rank, productOnPage: pageProduct && { name: pageProduct.name, price: pageProduct.price, currency: pageProduct.currency } })
      .catch(() => unavailable('ai_page', 'AI analysis failed.'))
      .then((o) => (blocked && o.status === 'unavailable' ? { ...o, evidence: [`Couldn't read the store page: ${blocked.message}.`, ...o.evidence] } : o))
      .then((o): SignalOutcome => (collected ? { ...o, collected } : o))
      .then((o) => {
        emit(o);
        return o;
      }),
  ]);

  price ??= await (earlyPrice ?? pastedLinkPrice(ai.product ? { ...ai.product, source: 'ai' as const } : null, targetPage!.finalUrl, priceDeps));
  if (pasted && targetPage) emit(price.outcome);

  const subject = (u: string, page: PageSnapshot | null): CloneSubject => ({
    url: u,
    siteName: page?.siteName ?? null,
    page: page ? { visibleText: [page.visibleText, page.aboutText].filter(Boolean).join('\n'), structure: page.structure } : undefined,
  });
  const compared = evaluateClone(
    subject(url.href, targetPage),
    peerUrls.map((u, i) => subject(u.href, peerPages[i] ?? null)),
  );
  if (blocked && input.peers.length) compared.evidence.unshift(`Couldn't read the store page: ${blocked.message}; only the web addresses were compared.`);
  const branded = withBrandHit(compared, brandInDomain(url.href, deps.brands === undefined ? defaultBrandLookup() : deps.brands, pop.rank));
  // A big retailer's name in this page's own site name, logo or banner, on someone else's address.
  const retailer = targetPage ? retailerOnPage({ url: targetPage.finalUrl, siteName: targetPage.siteName, title: targetPage.title, facts: targetPage.pageFacts, wellKnownRank: pop.rank }) : null;
  const clone = withRetailerHit(branded, retailer, targetPage?.finalUrl ?? url.href);
  emit(clone);

  const facts: ScanFacts = {
    domainAgeDays: domainAge.ageDays,
    validHttps: ssl.validHttps,
    priceBelowPeersPct: price.belowPct,
    threatHit: threat.hit,
    kernelOk: !!targetPage,
    wellKnownRank: pop.rank,
    aiInjection: confirmedInjection(ai.findings),
    reputationChecked: false,
  };
  const webReputation = await reputationP;
  facts.reputationChecked = webReputation.status !== 'unavailable';
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
    webReputation,
    kernel: { sessionId: kernel?.sessionId ?? null, liveViewUrl: kernel?.liveViewUrl, replayUrl: kernel?.replayUrl },
    scannedAt: now.toISOString(),
  });
  return { result, meta: { kernelSessionSeconds: kernel?.sessionSeconds ?? null, kernelError, ai: ai.usage ?? null, research, researchMs } };
}

interface PriceDeps {
  findOffers: FindOffers | undefined;
  researcher: WebResearcher | null;
  verdictFor?: (storeUrl: string) => Promise<Verdict | undefined>;
  research: ResearchUsage[];
}

/**
 * Price for a pasted link (spec 5.6, Nov 7): the page's product (JSON-LD, meta, else the AI's reading) against the
 * same item at other stores, with the usual rule (3+ offers, median, never this store or a store VoirCheck blocked).
 * Other stores come from the product search (Channel3); with fewer than 3 comparable offers there, from a web search
 * too (research step). Without enough comparable offers it stays "not checked" and says why, with no numbers.
 */
async function pastedLinkPrice(product: PageProduct | null, storeUrl: string, d: PriceDeps): Promise<{ outcome: SignalOutcome; belowPct: number | null }> {
  if (!product) return { outcome: unavailable('price', "Couldn't find one product and its price on this page, so prices weren't compared."), belowPct: null };
  const item = `"${product.name}"`;
  const fromChannel3 = d.findOffers ? await d.findOffers(product.name).catch(() => null) : null;
  let offers = fromChannel3 ?? [];
  const compare = () => comparablePrices({ name: product.name, currency: product.currency, storeUrl, offers });
  let cmp = compare();
  let usedWeb = false;
  if (cmp.prices.length < PRICE.minComparisonOffers && d.researcher) {
    const site = domainInfo(storeUrl);
    const web = await d.researcher.prices({ name: product.name, currency: product.currency, domain: site.registrable ?? site.hostname }).catch(() => ({ offers: null, usage: null }));
    if (web.usage) d.research.push(web.usage);
    if (web.offers?.length) {
      const verdicts = await Promise.all(web.offers.map((o) => (d.verdictFor ? d.verdictFor(new URL(o.storeUrl).origin).catch(() => undefined) : undefined)));
      offers = [...offers, ...web.offers.map((o, i) => ({ ...o, verdict: verdicts[i] }))];
      cmp = compare();
      usedWeb = true;
    }
  }
  if (!fromChannel3 && !usedWeb) return { outcome: unavailable('price', `Couldn't search other stores for ${item} right now, so its price wasn't compared.`), belowPct: null };
  const r = evaluatePrice({ price: product.price, title: product.name, peerPrices: cmp.prices, excludedBlocked: cmp.excludedBlocked });
  if (r.outcome.status !== 'unavailable') {
    const how = usedWeb ? (fromChannel3?.length ? 'a product search (Channel3) and a web search' : 'a web search') : 'a product search (Channel3)';
    r.outcome.evidence.push(`Compared with: ${cmp.sites.slice(0, 6).join(', ')} (found with ${how} for the same item${usedWeb ? '; web prices read by AI from search results' : ''}).`);
  }
  return r;
}
