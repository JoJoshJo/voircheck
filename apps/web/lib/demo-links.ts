import { demoResults } from '@voircheck/agent/search';

/**
 * The workspace's one-click "try it" links: the earbuds product at our fictional demo pair (legit, then scam), from
 * the same store config the agent's Demo mode uses. Server-side only (the workspace page passes them as props).
 */
export function demoTryLinks(baseUrl?: string): { safe: string; scam: string } {
  const [safe, scam] = demoResults('earbuds', 1, baseUrl || undefined);
  return { safe: safe!.productUrl, scam: scam!.productUrl };
}
