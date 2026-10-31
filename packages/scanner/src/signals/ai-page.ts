import type { CollectedFacts, EvidencePage } from '../evidence-pages';
import { unavailable, type SignalOutcome } from './types';

/**
 * Signal 4: AI page analysis. PLACEHOLDER until the Anthropic key arrives (spec 5.13).
 * The Haiku 5.5 implementation plugs in behind `PageAnalyzer`: no tools, JSON-only output (Zod-validated),
 * page text passed only through `wrapUntrustedPageText` and never treated as instructions.
 */

export interface PageForAnalysis {
  url: string;
  /** Everything in the DOM, including hidden text (planted injections hide there). */
  fullText: string;
  visibleText: string;
  /** Extra pages of the same store (legal notice, contact, terms, product). Untrusted, like the homepage text. */
  pages: EvidencePage[];
  /** Pattern-extracted facts over all pages (evidence only). */
  facts: CollectedFacts;
}

export interface PageAnalyzer {
  analyze(page: PageForAnalysis | null): Promise<SignalOutcome>;
}

export const UNTRUSTED_OPEN = '<untrusted_page_content>';
export const UNTRUSTED_CLOSE = '</untrusted_page_content>';

/** Label scanned page text as untrusted data; strips any copy of our delimiters so the page can't close the block itself. */
export function wrapUntrustedPageText(text: string, maxChars = 30_000): string {
  const cleaned = text.replaceAll(UNTRUSTED_OPEN, '').replaceAll(UNTRUSTED_CLOSE, '').slice(0, maxChars);
  return `${UNTRUSTED_OPEN}\n${cleaned}\n${UNTRUSTED_CLOSE}`;
}

export const placeholderAnalyzer: PageAnalyzer = {
  analyze: async () => unavailable('ai_page', 'AI analysis not yet enabled'),
};
