/**
 * One real Channel3 search, printed as normalized results only (no API key, no raw response).
 *   pnpm search "<query>" [--demo]
 * --demo merges in the demo pair (spec 5.4 Demo mode); default is real retailers only.
 */
import 'dotenv/config';
import { compareStores } from '@voircheck/agent/search';

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith('--'));
if (!query) {
  console.error('usage: pnpm search "<query>" [--demo]');
  process.exit(2);
}

const result = await compareStores(query, { apiKey: process.env.CHANNEL3_API_KEY, demoMode: args.includes('--demo') });
console.log(JSON.stringify(result, null, 2));
