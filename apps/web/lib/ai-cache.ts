import 'server-only';
import { aiPageCache } from '@voircheck/db/schema';
import { AiAnalysis, memoryAiCache, type AiResultCache } from '@voircheck/scanner';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from './db';

/**
 * AI page-analysis results in the database (J, Nov 11; table ai_page_cache, migration 0008), so a deploy or restart
 * doesn't wipe them and a free provider's daily quota isn't spent twice on the same page. Public store pages only.
 * Every read is validated again (a bad row is a miss). If the table isn't there yet, or the database fails, the
 * in-memory cache answers instead: a cache problem never breaks a scan.
 */
export function dbAiCache(fallback: AiResultCache = memoryAiCache(), now: () => Date = () => new Date()): AiResultCache {
  let dbOk = true;
  const quiet = (err: unknown) => {
    if (dbOk) console.error('ai_page_cache unavailable, using memory:', err instanceof Error ? err.message.slice(0, 120) : 'unknown error');
    dbOk = false;
  };
  return {
    async get(key) {
      if (dbOk) {
        try {
          const [row] = await getDb()
            .select({ value: aiPageCache.value })
            .from(aiPageCache)
            .where(and(eq(aiPageCache.key, key), gt(aiPageCache.expiresAt, now())))
            .limit(1);
          const parsed = row ? AiAnalysis.safeParse(row.value) : null;
          if (parsed?.success) return parsed.data;
        } catch (err) {
          quiet(err);
        }
      }
      return fallback.get(key);
    },
    async set(key, value, ttlMs) {
      await fallback.set(key, value, ttlMs);
      if (!dbOk) return;
      const expiresAt = new Date(now().getTime() + ttlMs);
      try {
        await getDb().insert(aiPageCache).values({ key, value, expiresAt }).onConflictDoUpdate({ target: aiPageCache.key, set: { value, expiresAt } });
      } catch (err) {
        quiet(err);
      }
    },
  };
}
