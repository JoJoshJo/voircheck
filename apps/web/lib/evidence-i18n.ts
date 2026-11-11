import type { Lang } from './i18n';

/**
 * Evidence lines are written by the scanner in English (packages/scanner, fixed sentences with values filled in).
 * This puts them into the person's language by matching those sentences. Values the scanner fills in (domains, store
 * names, prices, error messages) and quotes from store pages stay exactly as they are. A line we don't recognise is
 * shown in English rather than guessed at.
 */

type Rule = [RegExp, string | ((...m: string[]) => string)];

const PAGE_FR: Record<string, string> = { home: 'accueil', legal: 'mentions légales', contact: 'contact', terms: 'conditions', product: 'produit' };
const PAGE_EN: Record<string, string> = { home: 'home page', legal: 'legal notice', contact: 'contact', terms: 'terms', product: 'product page' };

/** A page label from the scan ("home", "legal 2") in the person's language. Unknown labels are left as they are. */
export function pageLabel(label: string, lang: Lang): string {
  const m = /^(home|legal|contact|terms|product)(?: (\d+))?$/.exec(label.trim());
  if (!m) return label;
  const name = (lang === 'fr' ? PAGE_FR : PAGE_EN)[m[1]!]!;
  return m[2] ? `${name} ${m[2]}` : name;
}

const SEV_FR: Record<string, string> = { low: 'mineur', med: 'modéré', high: 'grave' };
const KIND_FR: Record<string, string> = {
  'Tried to instruct AI agents': 'A tenté de donner des instructions aux agents IA',
  'Company details inconsistent': 'Coordonnées de l’entreprise incohérentes',
  'Unrealistic discounts': 'Remises irréalistes',
  'Fake scarcity or urgency': 'Fausse rareté ou urgence',
  'Missing legal information': 'Informations légales manquantes',
  'Copied or generic text': 'Texte copié ou générique',
  'Payment red flags': 'Paiement suspect',
  'Language mismatch': 'Langue inadaptée à la boutique',
};
const THREAT_FR: Record<string, string> = {
  malware: 'logiciel malveillant',
  'phishing / deceptive site': 'hameçonnage / site trompeur',
  'unwanted software': 'logiciel indésirable',
  'harmful app': 'application dangereuse',
  'a threat': 'une menace',
};

/** 1,234 → 1 234 (French thousands separator, narrow no-break space). */
const num = (n: string) => n.replace(/,/g, ' ');
const plural = (n: string, one: string, many: string) => (Number(n) <= 1 ? one : many);

function ageFr(age: string): string {
  let m = /^(\d+) days?$/.exec(age);
  if (m) return `${m[1]} ${plural(m[1]!, 'jour', 'jours')}`;
  m = /^about (\d+) months$/.exec(age);
  if (m) return `environ ${m[1]} mois`;
  m = /^about (\d+) years$/.exec(age);
  if (m) return `environ ${m[1]} ans`;
  return age;
}

/** The scanner's "blocked page" reasons (packages/scanner/src/blocked-page.ts). */
function blockedFr(msg: string): string {
  return msg
    .replace(/^blocked by a bot check/, 'bloquée par une vérification anti-robot')
    .replace(/^the store returned an error page/, 'la boutique a renvoyé une page d’erreur')
    .replace(/^the page showed no content \(empty shell\)/, 'la page était vide')
    .replace(/^it sent our check to (\S+) instead of showing its product page/, 'elle a renvoyé notre vérification vers $1 au lieu d’afficher sa page produit')
    .replace(/^it sent our check to (\S+) instead of showing its shop/, 'elle a renvoyé notre vérification vers $1 au lieu d’afficher sa boutique');
}

const FR: Rule[] = [
  // Domain age + reputation
  [/^The registry record for (\S+) has no registration date\.$/, 'Le registre de $1 n’indique pas de date d’enregistrement.'],
  [/^(\S+) was registered on (\d{4}-\d{2}-\d{2}) \((.+) ago\)\.$/, (_, d, date, age) => `${d} a été enregistré le ${date} (il y a ${ageFr(age!)}).`],
  [/^Registrar: (.+)\.$/, 'Bureau d’enregistrement : $1.'],
  [
    /^This store is a subdomain \((.+?)\) of the hosting provider (\S+), so the age shown is the provider's domain, not this store's\. The store itself could be brand new\.$/,
    'Cette boutique est un sous-domaine ($1) de l’hébergeur $2 : l’âge affiché est celui du domaine de l’hébergeur, pas de la boutique. La boutique elle-même peut être toute récente.',
  ],
  [/^(\S+) is not a registered domain name\.$/, '$1 n’est pas un nom de domaine enregistré.'],
  [/^Couldn't look up the registration of (\S+) \((.*)\)\.$/, 'Impossible de consulter l’enregistrement de $1 ($2).'],
  [
    /^(\S+) was first seen on (\d{4}-\d{2}-\d{2}) \((.+) ago\): its first certificate in the public certificate logs \(crt\.sh\)\. This is not the registration date; the domain may be older\.$/,
    (_, d, date, age) => `${d} est apparu pour la première fois le ${date} (il y a ${ageFr(age!)}) : son premier certificat dans les journaux publics de certificats (crt.sh). Ce n’est pas la date d’enregistrement ; le domaine peut être plus ancien.`,
  ],
  [/^No first certificate date either \((.+)\)\.$/, (_, why) => `Pas de date de premier certificat non plus (${({ 'no certificates found': 'aucun certificat trouvé', 'too many certificates to tell': 'trop de certificats pour conclure', 'unexpected answer': 'réponse inattendue', 'no certificate dates': 'aucune date de certificat', 'crt.sh took too long': 'crt.sh a mis trop de temps', 'crt.sh failed': 'crt.sh a échoué' } as Record<string, string>)[why!] ?? why}).`],
  [/^Couldn't check the Tranco top-sites list \(list (\S+) not available\)\.$/, 'Impossible de consulter la liste Tranco des sites les plus visités (liste $1 indisponible).'],
  [
    /^This store lives on a shared host \((\S+)\); the host's popularity says nothing about the store, so the Tranco top-sites list isn't used\.$/,
    'Cette boutique est sur un hébergement partagé ($1) : la popularité de l’hébergeur ne dit rien de la boutique, la liste Tranco n’est donc pas utilisée.',
  ],
  [
    /^Well-known site: (\S+) is #([\d,]+) in the Tranco top-sites research list \(list (\S+), (\S+)\)\. This alone doesn't make a store safe\.$/,
    (_, d, rank, list, date) => `Site connu : ${d} est n° ${num(rank!)} de la liste de recherche Tranco des sites les plus visités (liste ${list}, ${date}). Cela ne suffit pas à rendre une boutique fiable.`,
  ],
  [/^(\S+) is not in the Tranco top ([\d,]+) sites \(list (\S+)\)\.$/, (_, d, top, list) => `${d} ne figure pas parmi les ${num(top!)} sites les plus visités de Tranco (liste ${list}).`],

  // HTTPS and redirects
  [/^The page ends up on an unencrypted http:\/\/ address \((.+)\)\.$/, 'La page aboutit à une adresse http:// non chiffrée ($1).'],
  [/^The address is http:\/\/, not https:\/\/\.$/, 'L’adresse est en http://, pas en https://.'],
  [/^Valid HTTPS certificate\.$/, 'Certificat HTTPS valide.'],
  [/^The browser accepted the HTTPS certificate, but our own check didn't \((.*)\)\.$/, 'Le navigateur a accepté le certificat HTTPS, mais pas notre propre vérification ($1).'],
  [/^HTTPS certificate is not valid \((.*)\)\.$/, 'Le certificat HTTPS n’est pas valide ($1).'],
  [/^The browser loaded the page over valid HTTPS \(certificate details unavailable\)\.$/, 'Le navigateur a chargé la page en HTTPS valide (détails du certificat indisponibles).'],
  [/^Couldn't check the HTTPS certificate\.$/, 'Impossible de vérifier le certificat HTTPS.'],
  [/^Certificate issued by (.+)\.$/, 'Certificat émis par $1.'],
  [
    /^Certificate is (\d+) days? old \(auto-renewed certificates are often new, so this alone means little\)\.$/,
    (_, n) => `Le certificat a ${n} ${plural(n!, 'jour', 'jours')} (les certificats renouvelés automatiquement sont souvent récents : seul, cela veut dire peu de chose).`,
  ],
  [/^Redirects across domains: (.+)\.$/, 'Redirections entre domaines : $1.'],
  [/^Redirects stay on (\S+) \((\d+) hops?\)\.$/, (_, d, n) => `Les redirections restent sur ${d} (${n} ${plural(n!, 'étape', 'étapes')}).`],
  [/^No redirects\.$/, 'Aucune redirection.'],
  [/^Redirects weren't observed \(the cloud browser visit failed\)\.$/, 'Redirections non observées (la visite du navigateur cloud a échoué).'],
  [
    /^This shop sent our check to (\S+) instead of showing (its product page|its shop)\. Real shops don't hide their pages\.$/,
    (_, to, what) => `Cette boutique a renvoyé notre vérification vers ${to} au lieu d’afficher ${what === 'its shop' ? 'sa boutique' : 'sa page produit'}. Les vraies boutiques ne cachent pas leurs pages.`,
  ],
  [/^Couldn't verify this store: the cloud browser visit failed \((.*)\)\.$/, 'Impossible de vérifier cette boutique : la visite du navigateur cloud a échoué ($1).'],
  [/^Couldn't verify this store: (.+), so the cloud browser never saw the shop itself\.$/, (_, why) => `Impossible de vérifier cette boutique : ${blockedFr(why!)}, le navigateur cloud n’a donc jamais vu la boutique elle-même.`],

  // Price
  [/^The other stores sell different products, so prices are not compared\.$/, 'Les autres boutiques vendent des produits différents : les prix ne sont pas comparés.'],
  [/^Couldn't find the price of (.+) on this store\.$/, (_, item) => `Impossible de trouver le prix de ${item === 'this item' ? 'cet article' : item} sur cette boutique.`],
  [/^Not enough other trustworthy stores sell exactly (.+) to compare prices\.$/, (_, item) => `Trop peu d’autres boutiques fiables vendent exactement ${item === 'this item' ? 'cet article' : item} pour comparer les prix.`],
  [/^(\S+) here vs (\S+) typical \(the median of (\d+) other stores selling the same item\)\.$/, '$1 ici contre $2 habituellement (médiane de $3 autres boutiques vendant le même article).'],
  [/^([\d.]+)% below the other stores\.$/, (_, p) => `${p!.replace('.', ',')} % moins cher que les autres boutiques.`],
  [/^([\d.]+)% above the other stores\.$/, (_, p) => `${p!.replace('.', ',')} % plus cher que les autres boutiques.`],
  [/^Same as the other stores\.$/, 'Même prix que les autres boutiques.'],
  [/^Stores VoirCheck blocked were left out of the comparison\.$/, 'Les boutiques bloquées par VoirCheck ont été exclues de la comparaison.'],
  [/^A price this far below everyone else is a common sign of a fake shop\.$/, 'Un prix aussi bas par rapport à tous les autres est un signe fréquent de fausse boutique.'],
  [/^Couldn't read the store page: (.+), so its price is unknown\.$/, (_, why) => `Impossible de lire la page de la boutique : ${blockedFr(why!)}, son prix est donc inconnu.`],
  [/^Couldn't find one product and its price on this page, so prices weren't compared\.$/, 'Impossible de trouver un produit et son prix sur cette page : les prix n’ont pas été comparés.'],
  [/^Couldn't search other stores for (.+) right now, so its price wasn't compared\.$/, 'Impossible de chercher $1 dans d’autres boutiques pour le moment : son prix n’a pas été comparé.'],
  [/^Couldn't search other stores for (.+) \(no price search is set up\), so its price wasn't compared\.$/, 'Impossible de chercher $1 dans d’autres boutiques (aucune recherche de prix n’est configurée) : son prix n’a pas été comparé.'],
  [/^Couldn't search other stores for (.+) \(the price search failed\), so its price wasn't compared\.$/, 'Impossible de chercher $1 dans d’autres boutiques (la recherche de prix a échoué) : son prix n’a pas été comparé.'],
  [
    /^Compared with: (.+) \(found with (a product search \(Channel3\) and a web search|a web search|a product search \(Channel3\)) for the same item(; web prices read by AI from search results)?\)\.$/,
    (_, sites, how, web) =>
      `Comparé avec : ${sites} (trouvées par ${how === 'a web search' ? 'une recherche web' : how!.includes('and') ? 'une recherche de produits (Channel3) et une recherche web' : 'une recherche de produits (Channel3)'} pour le même article${web ? ' ; prix web lus par l’IA dans les résultats de recherche' : ''}).`,
  ],
  [/^Couldn't load the store page in the cloud browser, so its price is unknown\.$/, 'Impossible de charger la page de la boutique dans le navigateur cloud : son prix est donc inconnu.'],

  // Threat lists
  [/^Not on Google Safe Browsing threat lists \((\d+) address(?:es)? checked\)\.$/, (_, n) => `Absent des listes de menaces Google Safe Browsing (${n} ${plural(n!, 'adresse vérifiée', 'adresses vérifiées')}).`],
  [/^Google Safe Browsing lists (.+) as (.+)\.$/, (_, u, k) => `Google Safe Browsing classe ${u === 'this address' ? 'cette adresse' : u} comme ${THREAT_FR[k!] ?? k}.`],
  [/^Threat-list check is not configured\.$/, 'La vérification des listes de menaces n’est pas configurée.'],
  [/^Couldn't reach Google Safe Browsing \((.*)\)\.$/, 'Impossible de joindre Google Safe Browsing ($1).'],

  // Copycat check (whole lines)
  [/^No other stores to compare with\.$/, 'Aucune autre boutique à comparer.'],
  [
    /^This store shares its web address \((\S+)\) with the other demo stores, so the domain lookalike check can't tell them apart; names and page content are compared instead\.$/,
    'Cette boutique partage son adresse web ($1) avec les autres boutiques de démo : la vérification des domaines ne peut pas les distinguer, on compare donc les noms et le contenu des pages.',
  ],
  [/^Couldn't read the store page: (.+); only the web addresses were compared\.$/, (_, why) => `Impossible de lire la page de la boutique : ${blockedFr(why!)} ; seules les adresses web ont été comparées.`],
  [/^Couldn't compare: the cloud browser visit failed and the domains can't be compared\.$/, 'Comparaison impossible : la visite du navigateur cloud a échoué et les domaines ne peuvent pas être comparés.'],
  [
    /^Uses the brand name "(.+)" but isn't (.+)'s site \((\S+), #([\d,]+) in the Tranco top-sites list\)\. Real resellers exist, so this alone is a warning, not proof\.$/,
    (_, b, _b2, d, rank) => `Utilise le nom de marque "${b}" sans être le site de ${b} (${d}, n° ${num(rank!)} de la liste Tranco des sites les plus visités). De vrais revendeurs existent : seul, c’est un avertissement, pas une preuve.`,
  ],
  [
    /^This page presents itself as (.+?) \((site name|logo|banner): "(.*)"\), but its address is (\S+), not (.+?)'s\. Fake shops often borrow a big store's name\.$/,
    (_, name, where, quote, site) =>
      `Cette page se présente comme ${name} (${where === 'logo' ? 'logo' : where === 'banner' ? 'bandeau' : 'nom du site'} : "${quote}"), mais son adresse est ${site}, pas celle de ${name}. Les fausses boutiques empruntent souvent le nom d’une grande enseigne.`,
  ],
  [/^vs (.+?): (.*)$/, (_, label, rest) => `Face à ${label} : ${cloneFindingsFr(rest!)}`],

  // What the web says (research step)
  [/^Counts (\d+) points: (.+) lists this shop as a warning\.$/, (_, n, src) => `Compte ${n} points : ${src} signale cette boutique dans ses avertissements.`],
  [/^Counts (\d+) points: scam reports or warnings about this shop on 2 or more different sites\.$/, (_, n) => `Compte ${n} points : des signalements d’arnaque ou des avertissements sur cette boutique sur au moins 2 sites différents.`],
  [/^From a web search about (\S+) \((\d+) searches?; the shop's own site is never searched\)\.$/, (_, d, n) => `D’après une recherche web sur ${d} (${n} ${plural(n!, 'recherche', 'recherches')} ; le site de la boutique elle-même n’est jamais consulté).`],
  [/^The web search \((\d+) searches?\) found nothing written about (\S+) by other sites\.$/, (_, n, d) => `La recherche web (${n} ${plural(n!, 'recherche', 'recherches')}) n’a rien trouvé d’écrit sur ${d} par d’autres sites.`],
  [/^The web search \((\d+) searches?\) found only passing mentions of (\S+), no reviews or warnings\.$/, (_, n, d) => `La recherche web (${n} ${plural(n!, 'recherche', 'recherches')}) n’a trouvé que de simples mentions de ${d}, ni avis ni alerte.`],
  [/^(\d+) findings? without a real source link (?:was|were) left out\.$/, (_, n) => `${n} ${plural(n!, 'élément sans vrai lien source a été écarté', 'éléments sans vrai lien source ont été écartés')}.`],
  [/^The web search didn't give a usable answer \((.*)\), so what the web says wasn't checked\.$/, 'La recherche web n’a pas donné de réponse exploitable ($1) : l’avis du web n’a pas été vérifié.'],
  [/^The web search didn't complete, so what the web says wasn't checked\.$/, 'La recherche web n’a pas abouti : l’avis du web n’a pas été vérifié.'],
  [/^The web search took too long, so what the web says wasn't checked\.$/, 'La recherche web a pris trop de temps : l’avis du web n’a pas été vérifié.'],
  [/^The web search is off, so what the web says wasn't checked\.$/, 'La recherche web est désactivée : l’avis du web n’a pas été vérifié.'],
  [/^Today's web search budget is used up, so what the web says wasn't checked\.$/, 'Le budget de recherche web du jour est épuisé : l’avis du web n’a pas été vérifié.'],

  // Page analysis
  [/^AI page analysis is off \(no Anthropic API key\)\.$/, 'L’analyse de page par IA est désactivée (pas de clé API Anthropic).'],
  [/^No store page was read, so there was nothing to analyze\.$/, 'Aucune page de la boutique n’a été lue : rien à analyser.'],
  [/^AI page analysis failed \(the model call did not complete\)\.$/, 'L’analyse de page par IA a échoué (l’appel au modèle n’a pas abouti).'],
  [/^AI analysis failed\.$/, 'L’analyse par IA a échoué.'],
  [/^AI page analysis wasn't available: every AI provider failed or was busy\.$/, 'L’analyse de page par IA n’était pas disponible : tous les fournisseurs d’IA ont échoué ou étaient occupés.'],
  [/^AI page analysis returned no usable answer \((.+)\)\.$/, 'L’analyse de page par IA n’a pas donné de réponse exploitable ($1).'],
  [/^AI page analysis returned an answer in the wrong format, so it was ignored\.$/, 'L’analyse de page par IA a répondu dans un mauvais format : la réponse a été ignorée.'],
  [
    /^AI page analysis \((.+?)\): risk (\d+)\/100, (?:(\d+) findings?|nothing suspicious found)\.$/,
    (_, model, risk, n) => `Analyse de page par IA (${model}) : risque ${risk}/100, ${n ? `${n} ${plural(n, 'constat', 'constats')}` : 'rien de suspect'}.`,
  ],
  // Findings: the quote (or the AI's own note) stays exactly as written.
  [/^(.+?) \((low|med|high), (.+?)\): (".*")$/, (all, k, sev, page, quote) => (KIND_FR[k!] ? `${KIND_FR[k!]} (${SEV_FR[sev!]}, ${pageLabel(page!, 'fr')}) : ${quote}` : all!)],
  [/^(.+?) \((low|med|high), (.+?)\), AI note: (.*)$/, (all, k, sev, page, note) => (KIND_FR[k!] ? `${KIND_FR[k!]} (${SEV_FR[sev!]}, ${pageLabel(page!, 'fr')}), note de l’IA : ${note}` : all!)],
  [/^Couldn't read the store page: (.+)\.$/, (_, why) => `Impossible de lire la page de la boutique : ${blockedFr(why!)}.`],
  [/^Signal did not run\.$/, 'Vérification non effectuée.'],
];

/** The copycat check's per-store findings (packages/scanner/src/signals/clone.ts), sentence by sentence. Names stay as written. */
function cloneFindingsFr(text: string): string {
  return text
    .replace(/^no lookalike name or domain\.$/, 'aucun nom ni domaine ressemblant.')
    .replace(/"([^"]+)" swaps look-alike characters \(e\.g\. 0 for o, 1 for l\) into "([^"]+)"\./g, '"$1" remplace des lettres par des caractères ressemblants (p. ex. 0 pour o, 1 pour l) dans "$2".')
    .replace(/"([^"]+)" and "([^"]+)" differ only by hyphens, spacing or look-alike characters\./g, '"$1" et "$2" ne diffèrent que par des tirets, des espaces ou des caractères ressemblants.')
    .replace(/"([^"]+)" is "([^"]+)"'s name with extra words added \(([^)]*)\)\./g, '"$1" reprend le nom de "$2" en ajoutant des mots ($3).')
    .replace(/"([^"]+)" and "([^"]+)" both use the name "([^"]+)" with sales words added\./g, '"$1" et "$2" utilisent tous deux le nom "$3" avec des mots commerciaux en plus.')
    .replace(/"([^"]+)" and "([^"]+)" are (\d+) letters? apart\./g, (_, a, b, n) => `"${a}" et "${b}" ne diffèrent que de ${n} ${plural(n, 'lettre', 'lettres')}.`)
    .replace(
      /(Store-specific text|Page text) (\d+)% the same as (.+?)( \(copied content\))?; layout (\d+)% the same\./g,
      (_, which, t, label, copied, l) => `${which === 'Page text' ? 'Texte de la page' : 'Texte propre à la boutique'} identique à ${t} % à celui de ${label}${copied ? ' (contenu copié)' : ''} ; mise en page identique à ${l} %.`,
    )
    .replace(/(.+?) looks like the copy; this store looks like the original\./g, '$1 ressemble à la copie ; cette boutique ressemble à l’original.');
}

/** One evidence line in the person's language (English lines are returned as they are). */
export function evidenceLine(line: string, lang: Lang): string {
  if (lang !== 'fr') return line;
  for (const [re, to] of FR) {
    if (re.test(line)) return typeof to === 'string' ? line.replace(re, to) : line.replace(re, to as (...m: string[]) => string);
  }
  return line;
}
