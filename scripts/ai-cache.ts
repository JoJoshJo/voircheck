/**
 * 24h per-URL cache for AI page analysis results, on disk for the scripts (pnpm scan, pnpm eval:run), so a re-run
 * doesn't pay for the same page twice. `.cache/` is gitignored. Entries are re-validated on read.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AiAnalysis, type AiResultCache } from '@voircheck/scanner';

export function fileAiCache(dir = '.cache/ai-page', now: () => number = Date.now): AiResultCache {
  const file = (key: string) => `${dir}/${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`;
  return {
    async get(key) {
      try {
        const e = JSON.parse(readFileSync(file(key), 'utf8')) as { until: number; value: unknown };
        if (typeof e.until !== 'number' || e.until <= now()) return null;
        const v = AiAnalysis.safeParse(e.value);
        return v.success ? v.data : null;
      } catch {
        return null;
      }
    },
    async set(key, value, ttlMs) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(key), JSON.stringify({ until: now() + ttlMs, value }));
    },
  };
}
