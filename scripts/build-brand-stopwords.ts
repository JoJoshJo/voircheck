/**
 * Builds packages/scanner/data/brand-stopwords.txt: Tranco top-100k domain labels that are ordinary words, so the
 * brand-in-domain check (signals/brand-domain.ts) never treats "apple", "booking" or "kinder" as a brand.
 *   pnpm tsx scripts/build-brand-stopwords.ts [/path/to/wordlist]
 * English: the system word list (macOS /usr/share/dict/words, lowercase entries, plus plural -s). German / French /
 * web words: the hand list below. Re-run when the Tranco list is re-pinned.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { domainInfo } from '../packages/scanner/src/domain';
import { TRANCO } from '../packages/scanner/src/reputation';

const EXTRA = `
kinder haus mode garten moebel möbel sport sports mobel wohnen kaufen preis preise welt markt reise reisen urlaub auto autos
bank banki karte zeit spiel spiele essen leben stadt land wetter bild bilder buch buecher bücher musik kino film filme
maison jardin enfant enfants voyage voyages journal monde ville cuisine sante santé beaute beauté magasin boutique
online internet telecom webhosting hosting server servers cloud media news blog blogs forum portal sportal shop store
hotel hotels homes games gamer video videos photo photos music movie movies radio france paris tokyo india berlin
london stuttgart italia espana deutschland europe global world digital smart tech techno mobile casino crypto poker
`;

const words = readFileSync(process.argv[2] ?? '/usr/share/dict/words', 'utf8').split('\n').filter((w) => w && w === w.toLowerCase());
const dict = new Set([...words, ...EXTRA.split(/\s+/).filter(Boolean)]);
const isWord = (l: string) => dict.has(l) || (l.endsWith('s') && dict.has(l.slice(0, -1)));

const dataDir = join('packages', 'scanner', 'data');
const lines = gunzipSync(readFileSync(join(dataDir, TRANCO.file))).toString('utf8').split('\n');
const out = new Set<string>();
for (const d of lines) {
  const d2 = d.trim().toLowerCase();
  const l = d2 && !d2.startsWith('_') ? domainInfo(d2).siteLabel : null;
  if (l && /^[a-z0-9]{4,}$/.test(l) && isWord(l)) out.add(l);
}
writeFileSync(join(dataDir, 'brand-stopwords.txt'), `${[...out].sort().join('\n')}\n`);
console.log(`brand-stopwords.txt: ${out.size} words (Tranco ${TRANCO.listId})`);
