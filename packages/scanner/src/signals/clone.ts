import { domainInfo } from '../domain';
import type { SignalOutcome } from './types';
import { unavailable } from './types';

/**
 * Signal 6: clone / lookalike.
 * (a) lookalike names and domains vs the peers (homoglyphs like 0/o and 1/l, extra hyphens, added words like "outlet", small typos);
 * (b) page similarity vs the peer pages (word shingles for text, tag n-grams for structure).
 * Clones are symmetric (the original looks like its copy), so we also decide which side is the derivative:
 * the one with the substituted characters or the added marketing words.
 */

export const CLONE = {
  /**
   * Text similarity (5-word-shingle Jaccard) at or above this means "copied". Calibrated on the six demo stores
   * (Oct 28): with shared boilerplate removed, unrelated stores score ≤0.05 and real copies 0.28–0.89; without a
   * baseline (one peer) unrelated stores reach 0.21. Re-tune on the real-world test set. Structure is reported but
   * never decides: all demo stores share one template, so layout similarity is 57–89% everywhere.
   */
  copiedTextAtLeast: { withBaseline: 0.2, noBaseline: 0.3 },
  maxEditDistance: 2,
} as const;

const CONFUSABLE_SEQS: Array<[RegExp, string]> = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
];
const CONFUSABLE_CHARS: Record<string, string> = {
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '|': 'l',
  // Cyrillic / Greek letters that render like Latin ones
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ԁ': 'd', 'ɡ': 'g', 'ο': 'o', 'α': 'a', 'ν': 'v', 'ι': 'i',
};

const lower = (s: string) => s.normalize('NFKC').toLowerCase();

/** Visual skeleton used for comparison: "0ndaya" → "ondaya", "rnart" → "mart". */
export function skeleton(s: string): string {
  let out = [...lower(s)].map((c) => CONFUSABLE_CHARS[c] ?? c).join('');
  for (const [re, rep] of CONFUSABLE_SEQS) out = out.replace(re, rep);
  return out;
}

const hasConfusables = (s: string) => [...lower(s)].some((c) => c in CONFUSABLE_CHARS);
const rawTokens = (s: string) => lower(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Compared word by word on the skeleton; the raw words are kept for evidence text. */
const tokens = (s: string) => rawTokens(s).map(skeleton);

// Compared after skeleton(), like the names themselves ("clearance" → "dearance").
function skeletonSet(xs: string[]): Set<string> {
  return new Set(xs.map(skeleton));
}

/** Words scammers bolt onto a real brand. */
const MARKETING = skeletonSet(['outlet', 'outlets', 'deal', 'deals', 'sale', 'sales', 'clearance', 'official', 'discount', 'discounts', 'factory', 'store', 'shop', 'online', 'warehouse', 'direct', 'mall', 'liquidation', 'wholesale', 'cheap', 'offer', 'offers', 'promo', 'usa', 'us', 'global', 'express', 'hub', 'center', 'centre', 'best', 'super', 'mega']);
/** Generic words that don't identify a brand on their own. */
const GENERIC = skeletonSet(['home', 'market', 'supply', 'supplies', 'goods', 'co', 'company', 'inc', 'ltd', 'llc', 'the', 'and', 'of', 'shop', 'store', 'www']);

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export interface LookalikeRelation {
  lookalike: boolean;
  /** Which side looks like the copy: 'a', 'b', or null when we can't tell. */
  derivative: 'a' | 'b' | null;
  reason: string | null;
}

const NONE: LookalikeRelation = { lookalike: false, derivative: null, reason: null };

/** Compare two names (store names or domain labels). */
export function lookalike(a: string, b: string): LookalikeRelation {
  if (lower(a).trim() === lower(b).trim()) return NONE;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return NONE;

  if (ta.join('') === tb.join('')) {
    const ca = hasConfusables(a) && !hasConfusables(b);
    const cb = hasConfusables(b) && !hasConfusables(a);
    if (ca || cb) {
      const copy = ca ? a : b;
      return { lookalike: true, derivative: ca ? 'a' : 'b', reason: `"${copy}" swaps look-alike characters (e.g. 0 for o, 1 for l) into "${ca ? b : a}"` };
    }
    return { lookalike: true, derivative: null, reason: `"${a}" and "${b}" differ only by hyphens, spacing or look-alike characters` };
  }

  const sa = new Set(ta);
  const sb = new Set(tb);
  const brand = ta.find((t) => sb.has(t) && t.length >= 3 && !GENERIC.has(t) && !MARKETING.has(t));
  if (brand) {
    const extraA = ta.filter((t) => !sb.has(t));
    const extraB = tb.filter((t) => !sa.has(t));
    const subsetA = extraA.length === 0;
    const subsetB = extraB.length === 0;
    const marketingA = extraA.length > 0 && extraA.every((t) => MARKETING.has(t));
    const marketingB = extraB.length > 0 && extraB.every((t) => MARKETING.has(t));
    const words = (xs: string[]) => xs.map((x) => `"${x}"`).join(', ');
    const shownA = rawTokens(a).filter((_, i) => !sb.has(ta[i]!));
    const shownB = rawTokens(b).filter((_, i) => !sa.has(tb[i]!));
    if (subsetA || (marketingB && !marketingA)) return { lookalike: true, derivative: 'b', reason: `"${b}" is "${a}"'s name with extra words added (${words(shownB)})` };
    if (subsetB || (marketingA && !marketingB)) return { lookalike: true, derivative: 'a', reason: `"${a}" is "${b}"'s name with extra words added (${words(shownA)})` };
    if (marketingA && marketingB) return { lookalike: true, derivative: null, reason: `"${a}" and "${b}" both use the name "${brand}" with sales words added` };
  }

  const ja = ta.join('');
  const jb = tb.join('');
  const d = editDistance(ja, jb);
  if (d > 0 && d <= CLONE.maxEditDistance && Math.min(ja.length, jb.length) >= 5) {
    return { lookalike: true, derivative: null, reason: `"${a}" and "${b}" are ${d} letter${d > 1 ? 's' : ''} apart` };
  }
  return NONE;
}

// ---------- page similarity ----------

function words(text: string, strip: string[]): string[] {
  let t = lower(text);
  // Longest first, so "Nyuie Market" doesn't leave "Clearance" behind from "Nyuie Market Clearance".
  for (const s of [...strip].sort((a, b) => b.length - a.length)) if (s) t = t.split(lower(s)).join(' ');
  return t.split(/[^\p{L}]+/u).filter((w) => w.length > 1);
}

function shingles<T>(xs: T[], k: number): Set<string> {
  const out = new Set<string>();
  if (xs.length < k) {
    if (xs.length) out.add(xs.join(' '));
    return out;
  }
  for (let i = 0; i + k <= xs.length; i++) out.add(xs.slice(i, i + k).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export const textShingles = (text: string, stripNames: string[] = []) => shingles(words(text, stripNames), 5);

/** Text similarity 0..1; store names are stripped first so a renamed copy still matches. Prices/numbers are ignored. */
export function textSimilarity(a: string, b: string, stripNames: string[] = []): number {
  return jaccard(textShingles(a, stripNames), textShingles(b, stripNames));
}

/**
 * Similarity of a and b after dropping every shingle that also appears in a baseline page (another store in the
 * comparison). Shared catalog descriptions and template text then stop counting as "copied".
 */
export function distinctiveSimilarity(a: Set<string>, b: Set<string>, baseline: Set<string>[]): number {
  const keep = (s: Set<string>) => new Set([...s].filter((x) => !baseline.some((o) => o.has(x))));
  return jaccard(keep(a), keep(b));
}

/** Structure similarity 0..1 over the page's tag sequence. */
export function structureSimilarity(a: string[], b: string[]): number {
  return jaccard(shingles(a, 4), shingles(b, 4));
}

// ---------- the signal ----------

export interface CloneSubject {
  url: string;
  siteName: string | null;
  /** Absent when the KERNEL visit for this page failed. Text = the page plus its About/Contact page. */
  page?: { visibleText: string; structure: string[] };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const RANK = { pass: 0, warn: 1, fail: 2 } as const;

export function evaluateClone(target: CloneSubject, peers: CloneSubject[]): SignalOutcome {
  const id = 'clone' as const;
  const others = peers.filter((p) => p.url !== target.url);
  if (!others.length) return unavailable(id, 'No other stores to compare with.');

  const t = domainInfo(target.url);
  const evidence: string[] = [];
  let worst: keyof typeof RANK = 'pass';
  let compared = 0;
  let sharedHostNoted = false;
  const names = [target, ...others].map((x) => x.siteName).filter((n): n is string => !!n);
  const targetShingles = target.page ? textShingles(target.page.visibleText, names) : null;
  const peerShingles = others.map((x) => (x.page ? textShingles(x.page.visibleText, names) : null));

  for (const [i, peer] of others.entries()) {
    const p = domainInfo(peer.url);
    const label = peer.siteName ?? p.site ?? p.hostname;
    const findings: string[] = [];
    let targetIsCopy = false;
    let peerIsCopy = false;
    let ambiguous = false;

    const relations: LookalikeRelation[] = [];
    if (t.site && p.site && t.site !== p.site && t.siteLabel && p.siteLabel) {
      relations.push(lookalike(t.siteLabel, p.siteLabel));
      compared++;
    } else if (t.site === p.site && !sharedHostNoted) {
      evidence.push(`This store shares its web address (${t.site}) with the other demo stores, so the domain lookalike check can't tell them apart; names and page content are compared instead.`);
      sharedHostNoted = true;
    }
    if (target.siteName && peer.siteName) {
      relations.push(lookalike(target.siteName, peer.siteName));
      compared++;
    }
    for (const r of relations.filter((r) => r.lookalike)) {
      findings.push(`${r.reason}.`);
      if (r.derivative === 'a') targetIsCopy = true;
      else if (r.derivative === 'b') peerIsCopy = true;
      else ambiguous = true;
    }

    let copied = false;
    const ps = peerShingles[i];
    if (target.page && peer.page && targetShingles && ps) {
      compared++;
      const baseline = peerShingles.filter((x, j): x is Set<string> => j !== i && !!x);
      const text = baseline.length ? distinctiveSimilarity(targetShingles, ps, baseline) : jaccard(targetShingles, ps);
      const structure = structureSimilarity(target.page.structure, peer.page.structure);
      copied = text >= (baseline.length ? CLONE.copiedTextAtLeast.withBaseline : CLONE.copiedTextAtLeast.noBaseline);
      findings.push(
        `${baseline.length ? 'Store-specific text' : 'Page text'} ${pct(text)} the same as ${label}${copied ? ' (copied content)' : ''}; layout ${pct(structure)} the same.`,
      );
    }

    let status: keyof typeof RANK = 'pass';
    if (targetIsCopy && copied) status = 'fail';
    else if (targetIsCopy || ambiguous || (copied && !peerIsCopy)) status = 'warn';
    if (peerIsCopy && !targetIsCopy) findings.push(`${label} looks like the copy; this store looks like the original.`);
    if (RANK[status] > RANK[worst]) worst = status;
    evidence.push(`vs ${label}: ${findings.length ? findings.join(' ') : 'no lookalike name or domain.'}`);
  }

  if (compared === 0) return unavailable(id, ...evidence, "Couldn't compare: the cloud browser visit failed and the domains can't be compared.");
  return { id, status: worst, evidence: evidence.slice(0, 20) };
}
