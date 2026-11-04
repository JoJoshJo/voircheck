import type { Dict } from './i18n';

/**
 * The one plain sentence a card leads with. VoirCheck's checks are signs, not proof, so the sentence says how a shop
 * LOOKS, never what a business is. Safe adds "no warning signs" only when no check warned or failed, and "fair price"
 * only when the price check passed. Hold adds the question "buy anyway, or see why?".
 */
export function plainVerdict(t: Dict, scan: { verdict: 'SAFE' | 'HOLD' | 'BLOCK'; signals: ReadonlyArray<{ id: string; status: string }> }): { line: string; ask: string | null } {
  const p = t.plain;
  if (scan.verdict === 'BLOCK') return { line: p.block, ask: null };
  if (scan.verdict === 'HOLD') return { line: p.hold, ask: p.holdAsk };
  const noWarnings = scan.signals.every((s) => s.status !== 'warn' && s.status !== 'fail');
  const fairPrice = scan.signals.some((s) => s.id === 'price' && s.status === 'pass');
  const parts = [noWarnings ? p.noWarnings : null, fairPrice ? p.fairPrice : null].filter((x): x is string => !!x);
  if (!parts.length) return { line: p.safe, ask: null };
  const tail = parts.join(', ');
  return { line: `${p.safe} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`, ask: null };
}
