import 'server-only';
import { createSearchCache, type SearchCache } from '@voircheck/agent/search';

// Channel3 results from the last 10 minutes, shared by the agent and pasted-link price checks in this process (spec 5.4).
const g = globalThis as typeof globalThis & { __voircheckSearchCache?: SearchCache };
export const searchCache = () => (g.__voircheckSearchCache ??= createSearchCache());
