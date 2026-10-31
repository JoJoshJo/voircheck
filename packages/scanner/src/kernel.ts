import Kernel from '@onkernel/sdk';
import { z } from 'zod';
import { CHALLENGE_RE, MAX_CHALLENGE_TEXT } from './blocked-page';
import { EVIDENCE_BUDGET_MS, EvidencePage, MAX_EVIDENCE_TEXT, PageLink, type EvidenceKind } from './evidence-pages';
import { HiddenCandidate, HIDDEN_TEXT_JS } from './hidden-text';
import { errorMessage } from './signals/types';

/**
 * All store page visits happen in KERNEL's isolated cloud browser (spec 5.5 / 5.17). Our server never fetches a
 * store page: it sends KERNEL a Playwright snippet that runs next to the browser and returns only extracted data.
 * Every browser session is deleted in `finally`, including on timeout.
 */

export const PageSnapshot = z.object({
  requestedUrl: z.string(),
  finalUrl: z.string(),
  redirectChain: z.array(z.string()).max(30),
  httpStatus: z.number().nullable(),
  title: z.string().max(1000),
  siteName: z.string().max(300).nullable(),
  h1: z.string().max(1000).nullable(),
  visibleText: z.string().max(200_000),
  fullText: z.string().max(200_000),
  structure: z.array(z.string()).max(5000),
  aboutUrl: z.string().nullable(),
  aboutText: z.string().max(100_000).nullable(),
  /** The page's own <a href> links (absolute), for picking evidence pages. Never taken from page text. */
  links: z.array(PageLink).max(400),
  /** Text in the DOM but hidden from people (raw; filtered and flagged on our server). Untrusted. */
  // A malformed hidden-text report must never cost us the page itself.
  hiddenCandidates: z.array(HiddenCandidate).max(100).catch([]),
});
export type PageSnapshot = z.infer<typeof PageSnapshot>;

export type PageVisit = { ok: true; page: PageSnapshot } | { ok: false; error: string };

export interface KernelVisit {
  sessionId: string | null;
  liveViewUrl?: string;
  replayUrl?: string;
  /** Same order as the requested URLs. */
  pages: PageVisit[];
  /** Wall-clock seconds the browser session was open (KERNEL bills per browser-second). */
  sessionSeconds: number;
  /** Extra pages of the first URL's store, read in the same session (spec 5.5 multi-page evidence). */
  evidencePages?: EvidencePage[];
}

export interface VisitHooks {
  onSession?: (s: { sessionId: string; liveViewUrl?: string }) => void;
  /** Picks the first page's extra evidence pages from its own links; [] or absent = none. */
  evidenceLinks?: (page: PageSnapshot) => Array<{ url: string; kind: EvidenceKind }>;
}

export interface PageVisitor {
  /** Throws only when the browser itself can't be used; per-page failures come back in `pages`. */
  visit(urls: string[], hooks?: VisitHooks): Promise<KernelVisit>;
}

/**
 * Runs inside KERNEL's VM in one executor: each URL gets its own tab (the first reuses `page`, the tab the live view
 * shows), all in parallel. URLs are embedded as a JSON literal. Per-URL errors are returned, not thrown.
 * (One executor with many tabs: separate named executors per URL timed out at 6 pages in testing.)
 */
export function snapshotCode(urls: string[], navTimeoutMs: number, wakeWaitMs: number): string {
  return `
const urls = ${JSON.stringify(urls)};
// Free hosting tiers (e.g. Render) answer a sleeping service with a "waking up" holding page first.
// Scanning that page would compare the wrong content, so wait for the real page, or fail ("can't verify").
const WAKING = ${WAKING_RE.toString()};
const snapshot = async (page, requestedUrl) => {
let res = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: ${navTimeoutMs} });
const bodyText = () => page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
if (WAKING.test(await bodyText())) {
  const until = Date.now() + ${wakeWaitMs};
  let awake = false;
  while (Date.now() < until) {
    await page.waitForTimeout(4000);
    res = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: ${navTimeoutMs} }).catch(() => res);
    if (!WAKING.test(await bodyText())) { awake = true; break; }
  }
  if (!awake) throw new Error('the store was still starting up (hosting cold start)');
}
await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
// Bot checks (Cloudflare & co.) often clear on their own in a real browser: give them a few seconds.
// If still blocked, the server sees the challenge text and counts the scan as "couldn't verify".
const CHALLENGE = ${CHALLENGE_RE.toString()};
const shortChallenge = async () => { const t = await bodyText(); return t.length <= ${MAX_CHALLENGE_TEXT} && CHALLENGE.test(t + ' ' + (await page.title().catch(() => ''))); };
if (await shortChallenge()) {
  const until = Date.now() + ${CHALLENGE_WAIT_MS};
  while (Date.now() < until && (await shortChallenge())) await page.waitForTimeout(1500);
  await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
}
const chain = [];
for (let r = res ? res.request() : null; r; r = r.redirectedFrom()) chain.unshift(r.url());
const finalUrl = page.url();
if (chain[chain.length - 1] !== finalUrl) chain.push(finalUrl);
const data = await page.evaluate(() => {
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const title = document.title || '';
  const parts = title.split(/\\s+[·|–—-]\\s+/);
  const siteName = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || (parts.length > 1 ? parts[parts.length - 1] : title) || null;
  const clone = document.body ? document.body.cloneNode(true) : null;
  clone?.querySelectorAll('script,style,noscript,template').forEach((n) => n.remove());
  const structure = [];
  const walk = (el, depth) => {
    if (structure.length >= 5000 || depth > 40) return;
    structure.push(el.tagName.toLowerCase());
    for (const c of el.children) walk(c, depth + 1);
  };
  if (document.body) walk(document.body, 0);
  return {
    title: title.slice(0, 1000),
    siteName: siteName ? siteName.slice(0, 300) : null,
    h1: document.querySelector('h1')?.innerText?.trim().slice(0, 1000) || null,
    visibleText: (document.body?.innerText || '').slice(0, 200000),
    fullText: (clone?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200000),
    structure,
    links: [...new Map([...document.querySelectorAll('a[href]')]
      .map((a) => ({ href: a.href.split('#')[0].slice(0, 2048), text: (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\\s+/g, ' ').trim().slice(0, 200) }))
      .filter((l) => /^https?:/i.test(l.href))
      .map((l) => [l.href, l])).values()].slice(0, 400),
  };
});
// The store's own About/Contact page (same origin only): clones copy it word for word, and it's where contact info lives.
const hiddenCandidates = await page.evaluate(${HIDDEN_TEXT_JS}).catch(() => []);
const aboutUrl = await page.evaluate(() => {
  const here = location.href.split('#')[0];
  const links = [...document.querySelectorAll('a[href]')].filter((a) => a.origin === location.origin && a.href.split('#')[0] !== here);
  const pick = links.find((a) => /\\b(about|contact)\\b/i.test(a.innerText || '')) || links.find((a) => /about|contact/i.test(a.pathname));
  return pick ? pick.href.split('#')[0] : null;
}).catch(() => null);
let aboutText = null;
if (aboutUrl) {
  try {
    await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    aboutText = (await page.evaluate(() => document.body?.innerText || '')).slice(0, 100000);
  } catch {}
}
return { requestedUrl, finalUrl, redirectChain: chain.slice(0, 30), httpStatus: res ? res.status() : null, ...data, aboutUrl, aboutText, hiddenCandidates };
};
return await Promise.all(urls.map(async (u, i) => {
  try {
    const tab = i === 0 ? page : await context.newPage();
    return { ok: true, page: await snapshot(tab, u) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 300) };
  }
}));
`;
}

/**
 * Second step in the same session: open the picked evidence pages in parallel tabs within one shared time budget.
 * Plain navigations only (no clicks, no forms); each tab is closed after reading. Slow or missing pages are skipped.
 */
export function evidenceCode(targets: Array<{ url: string; kind: EvidenceKind }>, budgetMs: number): string {
  return `
const targets = ${JSON.stringify(targets)};
const deadline = Date.now() + ${budgetMs};
return await Promise.all(targets.map(async (t) => {
  let tab = null;
  try {
    tab = await context.newPage();
    const left = deadline - Date.now();
    if (left < 1500) return { ok: false, error: 'time budget used up' };
    await tab.goto(t.url, { waitUntil: 'domcontentloaded', timeout: left });
    await tab.waitForLoadState('networkidle', { timeout: Math.max(0, Math.min(2000, deadline - Date.now())) }).catch(() => {});
    const data = await tab.evaluate(() => {
      const clone = document.body ? document.body.cloneNode(true) : null;
      clone?.querySelectorAll('script,style,noscript,template').forEach((n) => n.remove());
      return {
        title: (document.title || '').slice(0, 1000),
        visibleText: (document.body?.innerText || '').slice(0, ${MAX_EVIDENCE_TEXT}),
        fullText: (clone?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_EVIDENCE_TEXT}),
      };
    });
    const hiddenCandidates = await tab.evaluate(${HIDDEN_TEXT_JS}).catch(() => []);
    return { ok: true, page: { url: t.url, finalUrl: tab.url(), kind: t.kind, ...data, hiddenCandidates } };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 200) };
  } finally {
    if (tab) await tab.close().catch(() => {});
  }
}));
`;
}

/** How long a bot check may take to clear itself before the page counts as blocked. */
const CHALLENGE_WAIT_MS = 10_000;

/** Holding pages shown by hosting providers while a sleeping service starts (Render's free tier). */
export const WAKING_RE = /SERVICE WAKING UP|INCOMING HTTP REQUEST DETECTED|APPLICATION LOADING/;

export interface KernelVisitorOptions {
  apiKey: string;
  /** Live view needs a headful browser (spec 5.5 scan UX). */
  liveView?: boolean;
  /** Try to record a replay; skipped quietly if the plan doesn't allow it. */
  replay?: boolean;
  /** Whole visit budget, browser create to last page. On expiry the scan is "couldn't verify". */
  totalTimeoutMs?: number;
  navTimeoutMs?: number;
  /** How long to wait for a sleeping store to wake up before the visit counts as failed. */
  wakeWaitMs?: number;
}

export function kernelVisitor(opts: KernelVisitorOptions): PageVisitor {
  const client = new Kernel({ apiKey: opts.apiKey, timeout: 20_000, maxRetries: 1 });
  const totalTimeoutMs = opts.totalTimeoutMs ?? 180_000;
  const navTimeoutMs = opts.navTimeoutMs ?? 45_000;
  const wakeWaitMs = opts.wakeWaitMs ?? 90_000;
  const execSec = Math.ceil((navTimeoutMs + wakeWaitMs + CHALLENGE_WAIT_MS) / 1000) + 20;
  if (execSec * 1000 >= totalTimeoutMs) throw new Error('totalTimeoutMs must exceed the page navigation budget');

  return {
    async visit(urls, hooks) {
      const started = Date.now();
      const browser = await client.browsers.create({
        headless: !(opts.liveView ?? true),
        stealth: false,
        // Inactivity backstop in case our delete below never runs (process crash).
        timeout_seconds: Math.ceil(totalTimeoutMs / 1000) + 30,
      }, { timeout: 20_000, maxRetries: 0 });
      const sessionId = browser.session_id;
      hooks?.onSession?.({ sessionId, liveViewUrl: browser.browser_live_view_url ?? undefined });
      let replayId: string | undefined;
      let replayUrl: string | undefined;
      try {
        if (opts.replay ?? true) {
          try {
            const replay = await client.browsers.replays.start(sessionId, { max_duration_in_seconds: Math.ceil(totalTimeoutMs / 1000) });
            replayId = replay.replay_id;
            replayUrl = replay.replay_view_url;
          } catch {
            // Replays may not be on this plan; the scan doesn't need them.
          }
        }

        const homepageWork = client.browsers.playwright
          .execute(
            sessionId,
            { code: snapshotCode(urls, navTimeoutMs, wakeWaitMs), timeout_sec: execSec },
            // The HTTP call must outlive the server-side execute timeout, and must not retry (that would re-run the visit).
            { timeout: (execSec + 10) * 1000, maxRetries: 0 },
          )
          .then((res): PageVisit[] => {
            if (!res.success) throw new Error((res.error ?? 'page visit failed').slice(0, 300));
            const raw = Array.isArray(res.result) ? res.result : [];
            return urls.map((_, i): PageVisit => {
              const item = raw[i] as { ok?: boolean; page?: unknown; error?: unknown } | undefined;
              if (!item?.ok) return { ok: false, error: typeof item?.error === 'string' ? item.error : 'page visit failed' };
              const parsed = PageSnapshot.safeParse(item.page);
              return parsed.success ? { ok: true, page: parsed.data } : { ok: false, error: 'unexpected page data from browser' };
            });
          });
        let evidencePages: EvidencePage[] = [];
        const work = homepageWork.then(async (pages) => {
          const first = pages[0];
          const targets = first?.ok && hooks?.evidenceLinks ? hooks.evidenceLinks(first.page).slice(0, 4) : [];
          // Only if the whole-visit budget still has room for the extra pages; they're optional evidence.
          if (targets.length && totalTimeoutMs - (Date.now() - started) > EVIDENCE_BUDGET_MS + 15_000) {
            const sec = Math.ceil(EVIDENCE_BUDGET_MS / 1000) + 10;
            evidencePages = await client.browsers.playwright
              .execute(sessionId, { code: evidenceCode(targets, EVIDENCE_BUDGET_MS), timeout_sec: sec }, { timeout: (sec + 10) * 1000, maxRetries: 0 })
              .then((res) => (res.success && Array.isArray(res.result) ? res.result : []))
              .then((raw) => raw.flatMap((item) => {
                const parsed = EvidencePage.safeParse((item as { ok?: boolean; page?: unknown })?.ok ? (item as { page?: unknown }).page : null);
                return parsed.success ? [parsed.data] : [];
              }))
              .catch(() => []);
          }
          return pages;
        });
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`cloud browser visit timed out after ${Math.round(totalTimeoutMs / 1000)}s`)), totalTimeoutMs - (Date.now() - started));
        });
        const pages = await Promise.race([work, timeout])
          .catch((err): PageVisit[] => urls.map(() => ({ ok: false, error: errorMessage(err) })))
          .finally(() => clearTimeout(timer));
        return { sessionId, liveViewUrl: browser.browser_live_view_url ?? undefined, replayUrl, pages, sessionSeconds: (Date.now() - started) / 1000, evidencePages };
      } finally {
        if (replayId) await client.browsers.replays.stop(replayId, { id_or_name: sessionId }).catch(() => {});
        await client.browsers.deleteByID(sessionId).catch(() => {});
      }
    },
  };
}
